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
    """Global logic that manages dynamic signal timings and intersection phases."""
    def __init__(self):
        self.lane_densities = [0, 0, 0, 0]
        self.signals = ['green', 'red', 'red', 'red']
        self.current_lane = 0
        self.timings = [10, 10, 10, 10] # Dynamic Green time allocated per lane
        self.last_switch_time = time.time()
        self.ga_best_multiplier = 2.5  # initial value
        
    def update_density(self, lane_id, count):
        self.lane_densities[lane_id] = count

    def decide_time(self, active_count):
        # --- Fuzzification ---
        low = max(0, (15 - active_count) / 15)          # decreases as count increases
        medium = max(0, 1 - abs(active_count - 20) / 10)
        high = max(0, (active_count - 15) / 15)

        # Avoid division by zero
        total = low + medium + high
        if total == 0:
            return 10

        # --- Rule Base ---
        # LOW → 15 sec
        # MEDIUM → 30 sec
        # HIGH → 50 sec
        time_val = (low * 15 + medium * 30 + high * 50) / total

        return int(time_val)

    def calculate_cycle_timings(self):
        self.genetic_optimize()  # run GA

        for i in range(4):
            base_time = self.decide_time(self.lane_densities[i])
            adjusted = min(50, int(base_time * (self.ga_best_multiplier / 2.5)))
            self.timings[i] = adjusted
                
    def update(self):
        now = time.time()
        elapsed = now - self.last_switch_time
        allocated = self.timings[self.current_lane]
        
        if elapsed >= allocated:
            self.current_lane = (self.current_lane + 1) % 4
            self.last_switch_time = now
            if self.current_lane == 0:
                self.calculate_cycle_timings()
                
            self.signals = ['red'] * 4
            self.signals[self.current_lane] = 'green'

    def get_state(self):
        now = time.time()
        remaining = max(0, int(self.timings[self.current_lane] - (now - self.last_switch_time)))
        return {
            'signals': self.signals,
            'remaining_time': remaining,
            'densities': self.lane_densities,
            'timings': self.timings
        }
    def genetic_optimize(self):
        # Simple GA to optimize multiplier
        population = np.random.uniform(1.5, 4.0, 10)

        def fitness(multiplier):
            score = 0
            for density in self.lane_densities:
                ideal = min(50, 8 + density * 2.5)  # expected
                predicted = min(50, 8 + density * multiplier)
                score += abs(ideal - predicted)
            return -score  # lower error = better

        for _ in range(5):  # generations
            scores = [(m, fitness(m)) for m in population]
            scores.sort(key=lambda x: x[1], reverse=True)

            # Select top 3
            top = [s[0] for s in scores[:3]]

            # Create new population
            new_population = []
            for _ in range(10):
                parent1, parent2 = np.random.choice(top, 2)
                child = (parent1 + parent2) / 2

                # Mutation
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
        
        # 5. Process Clusters & Tracking Prep
        for cluster in current_frame_clusters:
            xs = [c[0] for c in cluster]
            ys = [c[1] for c in cluster]
            min_x, min_y = min(xs), min(ys)
            max_x, max_y = max(xs), max(ys)
            
            for (gx, gy) in cluster:
                cv2.rectangle(out_frame, (gx, gy), (gx+self.GRID_SIZE, gy+self.GRID_SIZE), (128, 128, 128), 1)
            
            cv2.rectangle(out_frame, (min_x, min_y), (max_x+self.GRID_SIZE, max_y+self.GRID_SIZE), (0, 255, 0), 2)
            
            avg_x = int(sum(xs) / len(xs))
            avg_y = int(sum(ys) / len(ys))
            centroids.append((avg_x, avg_y))

        # ID Tracking logic maintaining user's intention
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