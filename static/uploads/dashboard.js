document.addEventListener("DOMContentLoaded", () => {
    // Traffic Engine Dynamic API Fetcher

    function fetchTrafficState() {
        fetch('/api/state')
            .then(res => res.json())
            .then(data => {
                const signals = data.signals;
                const remaining_time = data.remaining_time;
                const densities = data.densities;
                const passed = data.passing_counts; // Crossing count

                // Update countdown element if we create one later
                const countdownElem = document.getElementById('global-countdown');
                if (countdownElem) {
                    countdownElem.textContent = remaining_time + "s remaining";
                }

                for (let i = 0; i < 4; i++) {
                    const signal = signals[i];
                    const lightRed = document.getElementById(`light-${i}-red`);
                    const lightYellow = document.getElementById(`light-${i}-yellow`);
                    const lightGreen = document.getElementById(`light-${i}-green`);

                    // Reset all
                    if (lightRed) {
                        lightRed.classList.remove('bg-red-500', 'bg-alert-red', 'shadow-[0_0_10px_#ef4444]', 'shadow-[0_0_10px_#ff003c]');
                        lightRed.classList.add('opacity-30');
                    }
                    if (lightYellow) {
                        lightYellow.classList.remove('bg-amber-500', 'bg-yellow-400', 'shadow-[0_0_10px_#f59e0b]', 'shadow-[0_0_10px_#facc15]');
                        lightYellow.classList.add('opacity-30');
                    }
                    if (lightGreen) {
                        lightGreen.classList.remove('bg-emerald-500', 'bg-neon-cyan', 'shadow-[0_0_10px_#10b981]', 'shadow-[0_0_10px_#00f0ff]');
                        lightGreen.classList.add('opacity-30');
                    }

                    if (signal === 'red') {
                        if (lightRed) {
                            lightRed.classList.remove('opacity-30');
                            lightRed.classList.add('bg-alert-red', 'shadow-[0_0_10px_#ff003c]');
                        }
                    } else if (signal === 'yellow') {
                        if (lightYellow) {
                            lightYellow.classList.remove('opacity-30');
                            lightYellow.classList.add('bg-yellow-400', 'shadow-[0_0_10px_#facc15]');
                        }
                    } else if (signal === 'green') {
                        if (lightGreen) {
                            lightGreen.classList.remove('opacity-30');
                            lightGreen.classList.add('bg-neon-cyan', 'shadow-[0_0_10px_#00f0ff]');
                        }
                    }

                    // Stats Update
                    const count = densities[i];
                    let label = "VERY LOW";
                    if (count > 0 && count < 5) label = "LOW";
                    else if (count >= 5 && count < 10) label = "MEDIUM";
                    else if (count >= 10 && count < 20) label = "HIGH";
                    else if (count >= 20) label = "VERY HIGH";

                    const densityElem = document.getElementById(`density-${i}`);
                    if (densityElem) densityElem.textContent = `${count} [${label}]`;

                    const passElem = document.getElementById(`passed-${i}`);
                    if (passElem) passElem.textContent = `${passed[i]}`;

                    const presentElem = document.getElementById(`present-${i}`);
                    if (presentElem && data.present_counts) presentElem.textContent = `${data.present_counts[i]}`;

                    const timeContainer = document.getElementById(`time-container-${i}`);
                    const timeVal = document.getElementById(`time-${i}`);
                    if (timeContainer && timeVal) {
                        if (signal === 'green' || signal === 'yellow') {
                            timeContainer.style.display = 'flex';
                            timeVal.textContent = `${remaining_time}s`;
                        } else {
                            timeContainer.style.display = 'none';
                        }
                    }
                    
                    const priorityElem = document.getElementById(`priority-${i}`);
                    if (priorityElem && data.emergency_active) {
                        if (data.emergency_active[i]) {
                            priorityElem.textContent = "[AMBULANCE_DETECTED]";
                            priorityElem.className = "text-alert-red animate-pulse border border-alert-red/30 px-1 font-bold";
                        } else {
                            priorityElem.textContent = "[NEGATIVE]";
                            priorityElem.className = "text-slate-500 truncate font-bold";
                        }
                    }

                    const glitchElem = document.getElementById(`glitch-${i}`);
                    if (glitchElem && data.emergency_active) {
                        if (data.emergency_active[i]) {
                            glitchElem.style.display = 'block';
                        } else {
                            glitchElem.style.display = 'none';
                        }
                    }

                    const boxElem = document.getElementById(`box-${i}-signal`);
                    if (boxElem) {
                        const capitalized = signal.charAt(0).toUpperCase() + signal.slice(1);
                        if (signal === 'green') {
                            boxElem.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>SIGNAL: ${capitalized}`;
                            boxElem.className = "font-mono text-[10px] md:text-xs text-emerald-400 border border-[currentColor] px-2 py-1 shadow-[0_0_8px_currentColor] bg-black/80 backdrop-blur font-bold tracking-widest flex items-center";
                        } else if (signal === 'red') {
                            boxElem.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></span>SIGNAL: ${capitalized}`;
                            boxElem.className = "font-mono text-[10px] md:text-xs text-red-400 border border-[currentColor] px-2 py-1 shadow-[0_0_8px_currentColor] bg-black/80 backdrop-blur font-bold tracking-widest flex items-center";
                        } else {
                            boxElem.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 mr-2 animate-pulse"></span>SIGNAL: ${capitalized}`;
                            boxElem.className = "font-mono text-[10px] md:text-xs text-amber-400 border border-[currentColor] px-2 py-1 shadow-[0_0_8px_currentColor] bg-black/80 backdrop-blur font-bold tracking-widest flex items-center";
                        }
                    }
                }
            })
            .catch(err => console.error(err));
    }

    // Poll the backend memory every 500ms for fresh AI states
    setInterval(fetchTrafficState, 500);
});