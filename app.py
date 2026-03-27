import os
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

# Global State for the intersection
global_videos = [None, None, None, None]
signal_controller = SignalController()
lane_processors = [LaneProcessor(i) for i in range(4)]

def signal_updater():
    """Background Daemon enforcing the State Machine timing cycle."""
    while True:
        signal_controller.update()
        time.sleep(0.1)

# Start global background process
threading.Thread(target=signal_updater, daemon=True).start()

def generate_frames(lane_id):
    video_path = global_videos[lane_id]
    if not video_path or not os.path.exists(video_path):
        return
        
    cap = cv2.VideoCapture(video_path)
    processor = lane_processors[lane_id]
    
    while True:
        success, frame = cap.read()
        if not success:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
            
        # Optional: Resize massive frames for faster inference scaling
        frame = cv2.resize(frame, (640, 360))
            
        # Send frame into the CV pipeline
        is_green = (signal_controller.signals[lane_id] == 'green')
        out_frame, avg_density = processor.process_frame(frame, is_green)

        # IMPORTANT FIX
        signal_controller.update_density(lane_id, processor.current_present)
        
        # Serialize to JPEG
        ret, buffer = cv2.imencode('.jpg', out_frame)
        frame_bytes = buffer.tobytes()
        
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
               
        # Limit processing throughput (e.g. max ~20-25 FPS)
        time.sleep(0.04)

@app.route('/')
@app.route('/home')
def home():
    return render_template('index.html')

@app.route('/upload')
def upload():
    return render_template('upload.html')

@app.route('/simulation')
def simulation():
    return render_template('simulation.html')

@app.route('/dashboard', methods=['GET', 'POST'])
def dashboard():
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
            if not file or not file.filename:
                pass
            else:
                filename = secure_filename(f"node_{i}_{file.filename}")
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
                global_videos[i-1] = filepath.replace('\\', '/')
                
            lane = bases[i-1].copy()
            lane['video'] = True
            lanes_data.append(lane)
            
        session['uploaded_videos'] = lanes_data
        
        for i in range(4):
            lane_processors[i] = LaneProcessor(i)
            
        return render_template('dashboard.html', lanes=lanes_data)
        
    if 'uploaded_videos' in session and len(session['uploaded_videos']) == 4:
        return render_template('dashboard.html', lanes=session['uploaded_videos'])
        
    return redirect(url_for('upload'))

@app.route('/video_feed/<int:lane_id>')
def video_feed(lane_id):
    return Response(generate_frames(lane_id), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/state')
def api_state():
    state = signal_controller.get_state()
    state['passing_counts'] = [p.crossing_count for p in lane_processors]
    state['present_counts'] = [getattr(p, 'current_present', 0) for p in lane_processors]
    return jsonify(state)

@app.route('/reset')
def reset():
    if 'uploaded_videos' in session:
        for i in range(4):
            lane_processors[i] = LaneProcessor(i)
        for lane in session['uploaded_videos']:
            lane['d'] = 0
            lane['amb'] = 'NO'
            lane['alert'] = False
            lane['sig'] = 'WAIT'
        session.modified = True
    return redirect(url_for('home'))

@app.route('/reset_api', methods=['POST'])
def reset_api():
    if 'uploaded_videos' in session:
        for i in range(4):
            lane_processors[i] = LaneProcessor(i)
        for lane in session['uploaded_videos']:
            lane['d'] = 0
            lane['amb'] = 'NO'
            lane['alert'] = False
            lane['sig'] = 'WAIT'
        session.modified = True
    return '', 204

if __name__ == '__main__':
    app.run(debug=True)
