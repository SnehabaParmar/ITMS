import os
from platform import processor
import cv2
import time
import threading
from flask import Flask, render_template, request, redirect, url_for, flash, session, Response, jsonify
from werkzeug.utils import secure_filename
from traffic_engine import SignalController, LaneProcessor

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join(app.root_path, 'static', 'uploads')
app.secret_key = 'tactical_nexus_secret'

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# ================= GLOBAL STATE =================
global_videos = [None, None, None, None]
signal_controller = SignalController()
lane_processors = [LaneProcessor(i) for i in range(4)]

# 🔥 NEW: store latest processed frames
latest_frames = [None, None, None, None]

# 🔥 NEW: prevent multiple thread creation
workers_started = False

traffic_history = []
green_time_store = [0, 0, 0, 0]
last_update_time = time.time()
# --- Persistent State ---
last_green_times = [0, 0, 0, 0]
prev_green_lane = -1

total_emergencies = 0
priority_overrides = 0
prev_emergency_state = [False, False, False, False]
# =================================================

def signal_updater():
    global green_time_store, last_update_time

    while True:
        current_time = time.time()
        elapsed = current_time - last_update_time

        # 🔥 Get current signals
        signals = signal_controller.signals

        # 🔥 Find which lane is green
        if 'green' in signals:
            green_lane = signals.index('green')
            green_time_store[green_lane] += elapsed

        # 🔥 Update time reference
        last_update_time = current_time

        # Existing logic
        ambulance_present = False
        if signal_controller.emergency_active and signal_controller.emergency_lane is not None:
            ambulance_present = lane_processors[signal_controller.emergency_lane].emergency_active

        signal_controller.update(ambulance_present=ambulance_present)
        time.sleep(0.1)

threading.Thread(target=signal_updater, daemon=True).start()


# ================= 🔥 NEW BACKGROUND WORKER =================
def lane_worker(lane_id):
    cap = None
    current_path = None

    import random
    red_state = 'normal'
    red_counter = 0
    last_out_frame = None
    prev_is_red = False

    while True:

        # 🔥 CHECK VIDEO CHANGE
        if global_videos[lane_id] != current_path:
            current_path = global_videos[lane_id]

            if cap:
                cap.release()

            if current_path and os.path.exists(current_path):
                cap = cv2.VideoCapture(current_path)

                # 🔥 RESET EVERYTHING CLEAN
                lane_processors[lane_id] = LaneProcessor(lane_id)
                latest_frames[lane_id] = None

                # 🔥 RESET LOGIC STATES
                red_state = 'normal'
                red_counter = 0
                last_out_frame = None
                prev_is_red = False

            else:
                cap = None

        if cap is None:
            time.sleep(0.1)
            continue

        processor = lane_processors[lane_id]

        # SIGNAL STATE
        current_signal = signal_controller.signals[lane_id]
        is_green = (current_signal == 'green')
        is_red = (current_signal == 'red')

        if not prev_is_red and is_red:
            red_state = 'normal'
            red_counter = 1

        prev_is_red = is_red

        # ================= RED LOGIC =================
        if is_red:
            if red_counter <= 0:
                rand_val = random.random()
                if rand_val < 0.7:
                    red_state = 'freeze'
                    red_counter = random.randint(10, 30)
                elif rand_val < 0.9:
                    red_state = 'skip'
                    red_counter = random.randint(2, 5)
                else:
                    red_state = 'normal'
                    red_counter = random.randint(2, 5)

            if red_state == 'freeze' and red_counter > 0:
                red_counter -= 1
                if last_out_frame is not None:
                    latest_frames[lane_id] = last_out_frame
                    time.sleep(0.04)
                    continue

            if red_state == 'skip' and red_counter > 0:
                for _ in range(red_counter):
                    success, _ = cap.read()
                    if not success:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                red_counter = 0
                red_state = 'normal'

            if red_state == 'normal' and red_counter > 0:
                red_counter -= 1
        else:
            red_state = 'normal'
            red_counter = 0
        # ===========================================

        # READ FRAME
        success, frame = cap.read()
        if not success:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        frame = cv2.resize(frame, (640, 360))

        # PROCESS
        out_frame, avg_density, current_present, crossing_count = processor.process_frame(frame, is_green)
        last_out_frame = out_frame

        latest_frames[lane_id] = out_frame

        signal_controller.update_density(lane_id, processor.current_present)

        # 🚑 EMERGENCY
        # if processor.emergency_active and not signal_controller.emergency_active:
        #     signal_controller.trigger_emergency(lane_id)
        if (processor.emergency_active 
        and not signal_controller.emergency_active
        and signal_controller.emergency_phase is None):   # ← only trigger when fully idle
            signal_controller.trigger_emergency(lane_id)

        time.sleep(0.04)
# ===========================================================


# ================= STREAM ONLY =================
def generate_frames(lane_id):
    while True:
        frame = latest_frames[lane_id]

        if frame is None:
            time.sleep(0.05)
            continue

        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

        time.sleep(0.04)
# ==============================================

# --- Add to Global State ---
data_history = [] 
MAX_HISTORY = 100 # Keep the last 100 snapshots to prevent memory leaks

def history_recorder():
    """Background worker that records snapshots every 5 seconds."""
    while True:
        # Create a snapshot of the current system state
        snapshot = {
            'timestamp': time.time(),
            'present_counts': [getattr(p, 'current_present', 0) for p in lane_processors],
            'passing_counts': [p.crossing_count for p in lane_processors],
            'emergency_active': [getattr(p, 'emergency_active', False) for p in lane_processors]
        }
        
        data_history.append(snapshot)
        
        # Keep list size under control
        if len(data_history) > MAX_HISTORY:
            data_history.pop(0)
            
        time.sleep(5) # Record every 5 seconds

def update_persistent_data(state):
    global last_green_times, prev_green_lane
    global total_emergencies, priority_overrides, prev_emergency_state

    signals = state["signals"]
    timings = state["timings"]
    emergency_active = state["emergency_active"]

    # --- Green Time Tracking ---
    current_green_lane = signals.index("green") if "green" in signals else -1

    if current_green_lane != -1 and current_green_lane != prev_green_lane:
        last_green_times[current_green_lane] = timings[current_green_lane]
        prev_green_lane = current_green_lane

    # --- Emergency Tracking ---
    for i in range(4):
        if emergency_active[i]:
            if not prev_emergency_state[i]:
                total_emergencies += 1
                priority_overrides += 1
        prev_emergency_state[i] = emergency_active[i]

# Start the history recorder thread
threading.Thread(target=history_recorder, daemon=True).start()

# --- Update/Add API Route ---
@app.route('/api/history')
def get_history():
    return jsonify(data_history)


@app.route('/')
@app.route('/home')
def home():
    return render_template('index.html')


@app.route('/upload')
def upload():
    current_videos = [os.path.basename(v) if v else None for v in global_videos]
    return render_template('upload.html', current_videos=current_videos)


@app.route('/simulation')
def simulation():
    return render_template('simulation.html')


@app.route('/analysis')
def analysis():
    return render_template('analysis.html')


@app.route('/dashboard', methods=['GET', 'POST'])
def dashboard():
    global workers_started

    if request.method == 'POST':
        lanes_data = []
        bases = [
            {'id': '01', 'dir': 'NORTH_APPROACH', 'd': 0, 'sig': 'WAIT', 'sig_col': 'text-yellow-400', 'bg_sig': 'bg-yellow-400', 'amb': 'NO', 'alert': False},
            {'id': '02', 'dir': 'EAST_APPROACH',  'd': 0, 'sig': 'WAIT', 'sig_col': 'text-yellow-400', 'bg_sig': 'bg-yellow-400', 'amb': 'NO', 'alert': False},
            {'id': '03', 'dir': 'SOUTH_APPROACH', 'd': 0, 'sig': 'WAIT', 'sig_col': 'text-yellow-400', 'bg_sig': 'bg-yellow-400', 'amb': 'NO', 'alert': False},
            {'id': '04', 'dir': 'WEST_APPROACH',  'd': 0, 'sig': 'WAIT', 'sig_col': 'text-yellow-400', 'bg_sig': 'bg-yellow-400', 'amb': 'NO', 'alert': False}
        ]
        
        for i in range(1, 5):
            file = request.files.get(f'video_{i}')
            if file and file.filename:
                filename = secure_filename(f"node_{i}_{file.filename}")
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
                global_videos[i-1] = filepath.replace('\\', '/')
                latest_frames[i-1] = None
            lane = bases[i-1].copy()
            lane['video'] = True
            lanes_data.append(lane)
            
        session['uploaded_videos'] = lanes_data
        
        # for i in range(4):
        #     lane_processors[i] = LaneProcessor(i)
        for i in range(4):
            if request.files.get(f'video_{i+1}'):
                lane_processors[i] = LaneProcessor(i)

        # 🔥 START THREADS ONLY ONCE
        if not workers_started:
            for i in range(4):
                threading.Thread(target=lane_worker, args=(i,), daemon=True).start()
            workers_started = True
            
        return render_template('dashboard.html', lanes=lanes_data)
        
    if 'uploaded_videos' in session and len(session['uploaded_videos']) == 4 and all(v is not None for v in global_videos):
        return render_template('dashboard.html', lanes=session['uploaded_videos'])
        
    return redirect(url_for('upload'))


@app.route('/video_feed/<int:lane_id>')
def video_feed(lane_id):
    return Response(generate_frames(lane_id), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/api/state')
def api_state():
    state = signal_controller.get_state()

    # First enrich state
    state['passing_counts'] = [p.crossing_count for p in lane_processors]
    state['present_counts'] = [getattr(p, 'current_present', 0) for p in lane_processors]
    state['emergency_active'] = [getattr(p, 'emergency_active', False) for p in lane_processors]

    # THEN update persistent logic
    update_persistent_data(state)

    # Then attach persistent values
    state['last_green_times'] = last_green_times
    state['total_emergencies'] = total_emergencies
    state['priority_overrides'] = priority_overrides

    return jsonify(state)


@app.route('/reset')
def reset():
    if 'uploaded_videos' in session:
        for p in lane_processors:
            p.crossing_count = 0
            p.current_present = 0
            p.counts_history.clear()
            p.counted_ids.clear()
            p.first_y = {}
            p.gray_prev = None
            p.emergency_active = False
            p.emergency_linger = 0

    return redirect(url_for('home'))

@app.route('/reset_api', methods=['POST'])
def reset_api():
    for p in lane_processors:
        p.crossing_count = 0
        p.current_present = 0
        p.counts_history.clear()
        p.counted_ids.clear()
        p.first_y = {}
        p.gray_prev = None
        p.emergency_active = False
        p.emergency_linger = 0

    return '', 204

if __name__ == '__main__':
    app.run(debug=True)