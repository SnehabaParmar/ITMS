import numpy as np
import time
import cv2 # Allowed strictly for drawing bounding shapes/viz/frames

def get_gray(img):
    return (0.299 * img[:,:,2] + 0.587 * img[:,:,1] + 0.114 * img[:,:,0]).astype(np.uint8)

class Tracker:
    """Assigns and tracks IDs"""
    def __init__(self, max_disappeared=15, max_distance=100):
        self.next_object_id = 0
        self.objects = {} # id: (cx, cy)
        self.disappeared = {} # id: count
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

    def register(self, centroid):
        self.objects[self.next_object_id] = centroid
        self.disappeared[self.next_object_id] = 0
        self.next_object_id += 1

    def deregister(self, object_id):
        del self.objects[object_id]
        del self.disappeared[object_id]

    def update(self, centroids):
        if len(centroids) == 0:
            for obj_id in list(self.disappeared.keys()):
                self.disappeared[obj_id] += 1
                if self.disappeared[obj_id] > self.max_disappeared:
                    self.deregister(obj_id)
            return self.objects

        if len(self.objects) == 0:
            for i in range(len(centroids)):
                self.register(centroids[i])
        else:
            object_ids = list(self.objects.keys())
            object_centroids = list(self.objects.values())
            
            # Simple euclidean distance matching matrix
            D = np.zeros((len(object_centroids), len(centroids)))
            for i, oc in enumerate(object_centroids):
                for j, c in enumerate(centroids):
                    D[i, j] = np.linalg.norm(np.array(oc) - np.array(c))
                    
            used_rows = set()
            used_cols = set()
            
            flat_indices = np.argsort(D, axis=None)
            for flat_idx in flat_indices:
                row = flat_idx // D.shape[1]
                col = flat_idx % D.shape[1]
                
                if row in used_rows or col in used_cols:
                    continue
                if D[row, col] > self.max_distance:
                    continue
                    
                object_id = object_ids[row]
                self.objects[object_id] = centroids[col]
                self.disappeared[object_id] = 0
                used_rows.add(row)
                used_cols.add(col)
                
            for row in set(range(D.shape[0])) - used_rows:
                object_id = object_ids[row]
                self.disappeared[object_id] += 1
                if self.disappeared[object_id] > self.max_disappeared:
                    self.deregister(object_id)
                    
            for col in set(range(D.shape[1])) - used_cols:
                self.register(centroids[col])
                
        return self.objects

class SignalController:
    def __init__(self):
        self.lane_densities = [0, 0, 0, 0]
        self.signals = ['green', 'red', 'red', 'red']
        self.current_lane = 0
        self.timings = [10, 10, 10, 10]
        self.last_switch_time = time.time()
        self.ga_best_multiplier = 2.5

        # Emergency state
        self.emergency_lane = None
        self.saved_lane = None
        self.emergency_active = False
        self.emergency_phase = None  # 'prepare', 'active', 'clearing'
        self.phase_start_time = 0

    def update_density(self, lane_id, count):
        self.lane_densities[lane_id] = count

    def decide_time(self, active_count):
        low = max(0, (15 - active_count) / 15)
        medium = max(0, 1 - abs(active_count - 20) / 10)
        high = max(0, (active_count - 15) / 15)

        total = low + medium + high
        if total == 0:
            return 10

        time_val = (low * 15 + medium * 30 + high * 50) / total
        return int(time_val)

    def calculate_cycle_timings(self):
        self.genetic_optimize()

        for i in range(4):
            base = self.decide_time(self.lane_densities[i])
            self.timings[i] = min(50, int(base * (self.ga_best_multiplier / 2.5)))

    def trigger_emergency(self, lane_id):
        if not self.emergency_active:
            self.emergency_active = True
            self.emergency_lane = lane_id
            self.saved_lane = self.current_lane

            # Step 1 → give 3 sec to current lane
            self.timings[self.current_lane] = 3
            self.phase_start_time = time.time()
            self.emergency_phase = 'prepare'

    def update(self):
        now = time.time()

        # =============================
        # 🚑 EMERGENCY MODE
        # =============================
        if self.emergency_active:

            elapsed = now - self.phase_start_time

            # Step 1: Finish current lane (3 sec)
            if self.emergency_phase == 'prepare':
                if elapsed >= 3:
                    self.current_lane = self.emergency_lane
                    self.signals = ['red'] * 4
                    self.signals[self.current_lane] = 'green'

                    # dynamic timing (density + 10 buffer)
                    base_time = self.decide_time(self.lane_densities[self.current_lane])
                    self.timings[self.current_lane] = min(50, base_time + 10)

                    self.phase_start_time = now
                    self.emergency_phase = 'active'

            # Step 2: Emergency running
            elif self.emergency_phase == 'active':
                # wait until no retrigger → means ambulance gone
                if now - self.phase_start_time > self.timings[self.current_lane]:
                    self.phase_start_time = now
                    self.timings[self.current_lane] = 3
                    self.emergency_phase = 'clearing'

            # Step 3: Clearing (3 sec red)
            elif self.emergency_phase == 'clearing':
                if elapsed >= 3:
                    self.emergency_active = False

                    # Resume NORMAL order properly
                    self.current_lane = (self.saved_lane + 1) % 4
                    self.last_switch_time = now

                    self.signals = ['red'] * 4
                    self.signals[self.current_lane] = 'green'

                    return

            return  # STOP normal logic during emergency

        # =============================
        # 🚦 NORMAL MODE
        # =============================
        elapsed = now - self.last_switch_time
        allocated = self.timings[self.current_lane]

        # Yellow phase (last 3 sec)
        if int(allocated - elapsed) <= 3:
            if self.signals[self.current_lane] == 'green':
                self.signals[self.current_lane] = 'yellow'

        # Switch lane
        if elapsed >= allocated:
            self.current_lane = (self.current_lane + 1) % 4
            self.last_switch_time = now

            if self.current_lane == 0:
                self.calculate_cycle_timings()

            self.signals = ['red'] * 4
            self.signals[self.current_lane] = 'green'

    def get_state(self):
        now = time.time()

        if self.emergency_active:
            remaining = max(0, int(self.timings[self.current_lane] - (now - self.phase_start_time)))
        else:
            remaining = max(0, int(self.timings[self.current_lane] - (now - self.last_switch_time)))

        return {
            'signals': self.signals,
            'remaining_time': remaining,
            'densities': self.lane_densities,
            'timings': self.timings
        }

    def genetic_optimize(self):
        population = np.random.uniform(1.5, 4.0, 10)

        def fitness(m):
            score = 0
            for d in self.lane_densities:
                ideal = min(50, 8 + d * 2.5)
                predicted = min(50, 8 + d * m)
                score += abs(ideal - predicted)
            return -score

        for _ in range(5):
            scores = [(m, fitness(m)) for m in population]
            scores.sort(key=lambda x: x[1], reverse=True)

            top = [s[0] for s in scores[:3]]

            new_population = []
            for _ in range(10):
                p1, p2 = np.random.choice(top, 2)
                child = (p1 + p2) / 2

                if np.random.rand() < 0.3:
                    child += np.random.uniform(-0.2, 0.2)

                new_population.append(child)

            population = new_population

        self.ga_best_multiplier = population[0]
class LaneProcessor:
    """Processes a single lane video feed using grid-based clustering and tracking."""
    def __init__(self, lane_id):
        self.lane_id = lane_id
        self.gray_prev = None
        self.tracker = Tracker()
        self.counts_history = []
        self.crossing_count = 0
        self.counted_ids = set()
        
        # Parameters from User
        self.GRID_SIZE = 20
        self.THRESHOLD = 30  
        self.ENTRY_LINE_Y = None
        self.TOP_LINE_Y = None
        self.CLUSTER_THRESHOLD = self.GRID_SIZE * 3 
        self.current_present = 0
        self.emergency_active = False
        self.emergency_linger = 0
        
    def process_frame(self, frame, is_green):
        gray_curr = get_gray(frame)
        if self.ENTRY_LINE_Y is None:
            self.ENTRY_LINE_Y = int(gray_curr.shape[0] * 0.85)
            self.TOP_LINE_Y = int(gray_curr.shape[0] * 0.10)

        if self.gray_prev is None:
            self.gray_prev = gray_curr
            return frame, 0
            
        # 2. Manual Motion Mask (NumPy) diff
        diff = np.abs(gray_curr.astype(np.int16) - self.gray_prev.astype(np.int16)).astype(np.uint8)

        # 3. Scan for active Grid Blocks (Vectorized for speed)
        h, w = gray_curr.shape
        h_blocks = h // self.GRID_SIZE
        w_blocks = w // self.GRID_SIZE
        
        active_cells = []
        if h_blocks > 0 and w_blocks > 0:
            diff_cropped = diff[:h_blocks*self.GRID_SIZE, :w_blocks*self.GRID_SIZE]
            blocks = diff_cropped.reshape(h_blocks, self.GRID_SIZE, w_blocks, self.GRID_SIZE)
            block_means = blocks.mean(axis=(1, 3))
            
            active_y, active_x = np.where(block_means > self.THRESHOLD)
            for y_i, x_i in zip(active_y, active_x):
                active_cells.append((int(x_i * self.GRID_SIZE), int(y_i * self.GRID_SIZE)))

        # 4. Connected Components Grid Clustering
        current_frame_clusters = []
        unassigned_cells = set(active_cells)

        while unassigned_cells:
            start_cell = unassigned_cells.pop()
            cluster = [start_cell]
            queue = [start_cell]

            while queue:
                curr_cell = queue.pop(0)
                neighbors_to_add = []
                for cell in unassigned_cells:
                    dist = np.sqrt((curr_cell[0]-cell[0])**2 + (curr_cell[1]-cell[1])**2)
                    if dist <= self.CLUSTER_THRESHOLD:
                        neighbors_to_add.append(cell)
                        
                for n in neighbors_to_add:
                    unassigned_cells.remove(n)
                    cluster.append(n)
                    queue.append(n)

            current_frame_clusters.append(cluster)

        out_frame = frame.copy()
        centroids = []
        
        has_emergency_this_frame = False
        
        # 5. Process Clusters & Tracking Prep
        for cluster in current_frame_clusters:
            xs = [c[0] for c in cluster]
            ys = [c[1] for c in cluster]
            min_x, min_y = min(xs), min(ys)
            max_x, max_y = max(xs), max(ys)
            
            # --- EMERGENCY DETECT VISUAL HEURISTICS ---
            width = (max_x - min_x) + self.GRID_SIZE
            height = (max_y - min_y) + self.GRID_SIZE
            
            # 1. Size check
            is_large = width > 40 and height > 40
            
            is_ambulance_visually = False
            
            if is_large:
                # Extract original frame slice corresponding to the cluster bbox
                fy1, fy2 = max(0, min_y), min(frame.shape[0], max_y + self.GRID_SIZE)
                fx1, fx2 = max(0, min_x), min(frame.shape[1], max_x + self.GRID_SIZE)
                roi = frame[fy1:fy2, fx1:fx2]
                
                if roi.size > 0:
                    # 2. White color check
                    white_mask = cv2.inRange(roi, (180, 180, 180), (255, 255, 255))
                    white_ratio = cv2.countNonZero(white_mask) / (roi.shape[0] * roi.shape[1] + 1e-5)
                    is_white = white_ratio > 0.12 
                    
                    if is_white:
                        # 3. Flashing red/blue light check
                        # Crop to top 50% where the lightbar is located. This ignores side-door logos!
                        top_h = max(5, int(roi.shape[0] * 0.5))
                        roi_top = roi[:top_h, :]
                        
                        hsv = cv2.cvtColor(roi_top, cv2.COLOR_BGR2HSV)
                        
                        # Look for HIGH saturation (intense color) and HIGH value (bright LED lights)
                        mask_red1 = cv2.inRange(hsv, (0, 100, 210), (10, 255, 255))
                        mask_red2 = cv2.inRange(hsv, (170, 100, 210), (180, 255, 255))
                        red_mask = cv2.bitwise_or(mask_red1, mask_red2)
                        
                        blue_mask = cv2.inRange(hsv, (100, 100, 210), (130, 255, 255))
                        
                        red_pixels = cv2.countNonZero(red_mask)
                        blue_pixels = cv2.countNonZero(blue_mask)
                        
                        if red_pixels > 12 or blue_pixels > 12:
                            is_ambulance_visually = True
                            has_emergency_this_frame = True
            
            if is_ambulance_visually:
                cv2.rectangle(out_frame, (min_x, min_y), (max_x+self.GRID_SIZE, max_y+self.GRID_SIZE), (255, 0, 255), 4)
                cv2.putText(out_frame, "EMERGENCY", (min_x, min_y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 0, 255), 2)
            else:
                for (gx, gy) in cluster:
                    cv2.rectangle(out_frame, (gx, gy), (gx+self.GRID_SIZE, gy+self.GRID_SIZE), (128, 128, 128), 1)
                cv2.rectangle(out_frame, (min_x, min_y), (max_x+self.GRID_SIZE, max_y+self.GRID_SIZE), (0, 255, 0), 2)

            avg_x = int(sum(xs) / len(xs))
            avg_y = int(sum(ys) / len(ys))
            centroids.append((avg_x, avg_y))

        if has_emergency_this_frame:
            self.emergency_active = True
            self.emergency_linger = 30 # hold for 1-2 seconds
        else:
            if self.emergency_linger > 0:
                self.emergency_linger -= 1
                self.emergency_active = True
            else:
                self.emergency_active = False

        # ID Tracking logic
        objects = self.tracker.update(centroids)
        self.counts_history.append(len(objects))
        if len(self.counts_history) > 30:
            self.counts_history.pop(0)
            
        avg_density = int(np.mean(self.counts_history)) if self.counts_history else 0
        
        # Draw Lines (Top ROI Boundary & Bottom Exit)
        line_color = (0, 255, 0) if is_green else (0, 0, 255)
        cv2.line(out_frame, (0, self.ENTRY_LINE_Y), (w, self.ENTRY_LINE_Y), line_color, 2)
        cv2.line(out_frame, (0, self.TOP_LINE_Y), (w, self.TOP_LINE_Y), (255, 165, 0), 2)
        
        # Determine actual valid present vehicles inside ROI
        active_cnt = 0
        
        # COUNTING LOGIC & ROI Checks
        for obj_id, centroid in objects.items():
            cx, cy = centroid
            
            # ROI Density check
            if self.TOP_LINE_Y <= cy <= self.ENTRY_LINE_Y:
                active_cnt += 1
                
            if obj_id not in getattr(self, 'first_y', {}):
                if not hasattr(self, 'first_y'): self.first_y = {}
                self.first_y[obj_id] = cy
                
            # True Crossing Test ensuring it didn't just spawn below the line
            if self.first_y[obj_id] < self.ENTRY_LINE_Y and cy >= self.ENTRY_LINE_Y and obj_id not in self.counted_ids:
                self.crossing_count += 1
                self.counted_ids.add(obj_id)

        self.current_present = active_cnt

        self.gray_prev = gray_curr
        return out_frame, avg_density