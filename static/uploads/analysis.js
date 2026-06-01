document.addEventListener('DOMContentLoaded', () => {
    // --- Chart Colors ---
    const chartColors = {
        cyan: '#00f0ff',
        purple: '#8a2be2',
        yellow: '#facc15',
        red: '#ff003c',
        emerald: '#10b981',
        orange: '#fb923c',
        slate: '#475569'
    };

    // --- Canvas Contexts ---
    const ctxVolume = document.getElementById('trafficVolumeChart').getContext('2d');
    const ctxComparison = document.getElementById('laneComparisonChart').getContext('2d');
    const ctxWait = document.getElementById('waitingTimeChart').getContext('2d');
    const ctxSignalCompare = document.getElementById('signalCompareChart').getContext('2d');
    const ctxDensity = document.getElementById('densityDistributionChart').getContext('2d');
    const ctxEmergency = document.getElementById('emergencyEventChart').getContext('2d');

    // --- Chart Initialization ---
    Chart.register({
        id: 'shadow3d',
        beforeDraw(chart) {
            const ctx = chart.ctx;
            ctx.save();
            // ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            // ctx.shadowBlur = 20;
            // ctx.shadowOffsetY = 10;
        },
        afterDraw(chart) {
            chart.ctx.restore();
        }
    });

    const volumeChart = new Chart(ctxVolume, {
        type: 'line',
        data: {
            datasets: [
                { label: 'North Lane', data: [], borderColor: chartColors.cyan, backgroundColor: 'transparent', borderWidth: 2, tension: 0.4, pointRadius: 3 },
                { label: 'East Lane', data: [], borderColor: chartColors.purple, backgroundColor: 'transparent', borderWidth: 2, tension: 0.4, pointRadius: 3 },
                { label: 'South Lane', data: [], borderColor: chartColors.yellow, backgroundColor: 'transparent', borderWidth: 2, tension: 0.4, pointRadius: 3 },
                { label: 'West Lane', data: [], borderColor: chartColors.emerald, backgroundColor: 'transparent', borderWidth: 2, tension: 0.4, pointRadius: 3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'minute',
                        displayFormats: {
                            minute: 'HH:mm'
                        }
                    },
                    ticks: {
                        color: '#94a3b8'
                    },
                    grid: {
                        color: '#1e293b'
                    }
                }, y: { beginAtZero: true, suggestedMax: 15 }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: '#94a3b8', font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        title: function (context) {
                            const date = new Date(context[0].parsed.x);
                            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        },
                        label: function (context) {
                            return `Peak Vehicles: ${context.parsed.y}`;
                        }
                    }
                }
            }
        }
    });

    const comparisonChart = new Chart(ctxComparison, {
        type: 'bar',
        data: {
            labels: ['North', 'East', 'South', 'West'],
            datasets: [{ label: 'Vehicles Passed', data: [0, 0, 0, 0], backgroundColor: [chartColors.purple, chartColors.cyan, chartColors.purple, chartColors.cyan], borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
    });

    const waitingChart = new Chart(ctxWait, {
        type: 'bar',
        data: {
            labels: ['North', 'East', 'South', 'West'],
            datasets: [{
                label: 'Estimated Wait (s)',
                data: [0, 0, 0, 0],
                backgroundColor: chartColors.yellow + '80',
                borderColor: chartColors.yellow,
                borderWidth: 1,
                borderRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,   // 🔥 ADD THIS
            responsiveAnimationDuration: 0,
            resizeDelay: 0,
            indexAxis: 'y',
            scales: {
                x: { beginAtZero: true },
                y: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });

    const signalCompareChart = new Chart(ctxSignalCompare, {
        type: 'bar',
        data: {
            labels: ['North', 'East', 'South', 'West'],
            datasets: [
                {
                    label: 'Static System',
                    data: [60, 60, 60, 60], // fixed seconds per lane
                    backgroundColor: chartColors.slate,
                    borderRadius: 4
                },
                {
                    label: 'Smart System',
                    data: [0, 0, 0, 0], // will update dynamically
                    backgroundColor: chartColors.cyan,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Green Time (seconds)'
                    }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#94a3b8' }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ': ' + context.raw + ' s';
                        }
                    }
                }
            }
        }
    });

    const densityChart = new Chart(ctxDensity, {
        type: 'doughnut',
        data: { labels: ['Low', 'Medium', 'High'], datasets: [{ data: [0, 0, 0], backgroundColor: [chartColors.emerald, chartColors.yellow, chartColors.red], borderWidth: 2, borderColor: '#050505' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } } } }
    });

    const emergencyChart = new Chart(ctxEmergency, {
        type: 'bar',
        data: { labels: ['Active Alerts'], datasets: [{ label: 'Intensity', data: [0], backgroundColor: chartColors.red, borderRadius: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { display: false, beginAtZero: true, max: 1 }, x: { display: false } }, plugins: { legend: { display: false } } }
    });

    // --- Update Function ---
    // Utility to aggregate points into minute buckets
    function aggregatePerMinute(dataPoints) {
        const buckets = {};
        dataPoints.forEach(point => {
            const minute = Math.floor(point.x / 60000); // 60000 ms = 1 minute
            if (!buckets[minute]) buckets[minute] = [];
            buckets[minute].push(point.y);
        });

        // Take max per minute
        const aggregated = [];
        for (const min in buckets) {
            const yMax = Math.max(...buckets[min]);
            aggregated.push({ x: min * 60000, y: yMax });
        }
        return aggregated;
    }

    let lastWaitUpdate = 0;
    function updateAnalysis() {
        Promise.all([
            fetch('/api/history').then(res => res.json()),
            fetch('/api/state').then(res => res.json())
        ])
            .then(([history, state]) => {
                if (!history.length) return;
                // const latest = history[history.length - 1];
                const latest = history.length ? history[history.length - 1] : null;
                const now = Date.now() / 1000;

                // Total Vehicles
                // const totalPassed = latest.passing_counts.reduce((a, b) => a + b, 0);
                const totalPassed = state.passing_counts.reduce((a, b) => a + b, 0);
                document.getElementById('total-vehicles').textContent = totalPassed;

                // 1. Volume Chart
                // Reset datasets
                for (let i = 0; i < 4; i++) {
                    volumeChart.data.datasets[i].data = [];
                }

                // Temporary raw storage
                let laneRawData = [[], [], [], []];

                // Collect raw data
                history.forEach(snapshot => {
                    const timestamp = snapshot.timestamp * 1000; // ensure ms

                    snapshot.present_counts.forEach((count, laneIndex) => {
                        laneRawData[laneIndex].push({ x: timestamp, y: count });
                    });
                });

                // Aggregate per minute (take MAX)
                for (let i = 0; i < 4; i++) {
                    const aggregated = aggregatePerMinute(laneRawData[i]);
                    volumeChart.data.datasets[i].data = aggregated;
                }
                volumeChart.update('none');

                // 2. Comparison Chart
                comparisonChart.data.datasets[0].data = state.passing_counts;
                comparisonChart.update('none');


                // 4. Signal Chart (keep static 25% each)
                // Update chart using last known green times
                // signalCompareChart.data.datasets[1].data = [...lastGreenTimes];
                signalCompareChart.data.datasets[1].data = state.last_green_times || [0, 0, 0, 0];
                signalCompareChart.update('none');

                // 5. Density Chart
                let densityCounts = [0, 0, 0];
                state.present_counts.forEach(c => {
                    if (c < 4) densityCounts[0]++;
                    else if (c < 10) densityCounts[1]++;
                    else densityCounts[2]++;
                });
                densityChart.data.datasets[0].data = densityCounts;
                densityChart.update('none');

                // 6. Emergency Chart
                let activeEmergencies = (state.emergency_active || []).filter(e => e).length;

                document.getElementById('total-emergencies').textContent = state.total_emergencies;
                document.getElementById('priority-overrides-val').textContent = state.priority_overrides;
                document.getElementById('emergency-count-val').textContent = state.total_emergencies;

                const statusElem = document.getElementById('emergency-last-status');
                const cardElem = document.getElementById('emergency-kpi-card');

                if (activeEmergencies > 0) {
                    statusElem.textContent = "EMERGENCY_VEHICLE_PRIORITY";
                    statusElem.style.color = "#ff003c";
                    cardElem.style.borderColor = "#ff003c";
                    emergencyChart.data.datasets[0].data = [1];
                } else {
                    statusElem.textContent = "NO ACTIVE ALERTS";
                    statusElem.style.color = "";
                    cardElem.style.borderColor = "";
                    emergencyChart.data.datasets[0].data = [0];
                }
                emergencyChart.update('none');

                // System Status
                const totalPresent = state.present_counts.reduce((a, b) => a + b, 0);
                const sysStatus = document.getElementById('system-status');
                if (activeEmergencies > 0) {
                    sysStatus.textContent = "EMERGENCY MODE";
                    sysStatus.className = "text-xl font-bold text-red-500";
                } else if (totalPresent > 25) {
                    sysStatus.textContent = "CONGESTED";
                    sysStatus.className = "text-xl font-bold text-orange-500";
                } else {
                    sysStatus.textContent = "OPTIMAL";
                    sysStatus.className = "text-xl font-bold text-emerald-400";
                }
            })
            .catch(err => console.error("History Sync Error:", err));
    }
    function updateWaitingChart() {
        // Guard: don't run if chart isn't ready
        if (!waitingChart) return;

        fetch('/api/state')
            .then(res => res.json())
            .then(state => {
                const present = state.present_counts;
                const signals = state.signals;
                const timings = state.timings;

                // Guard: don't run if data isn't ready
                if (!signals || !timings || !present) return;
                if (signals.length < 4 || timings.length < 4) return;

                const currentLane = signals.indexOf('green');
                if (currentLane === -1) return; // no green lane yet, skip

                const SERVICE_TIME = 2;
                let waitTimes = [];

                for (let i = 0; i < 4; i++) {
                    let vehicles = present[i] || 0;
                    let timeToGreen = 0;

                    if (i !== currentLane) {
                        for (let j = 0; j < 4; j++) {
                            let laneIndex = (currentLane + j) % 4;
                            if (laneIndex === i) break;
                            // Guard against undefined timing
                            timeToGreen += (timings[laneIndex] || 0);
                        }
                    }

                    waitTimes.push(Math.round(vehicles * SERVICE_TIME + timeToGreen));
                }

                // Final guard: skip update if any value is NaN
                if (waitTimes.some(v => isNaN(v))) return;

                waitingChart.data.datasets[0].data = waitTimes;
                // 🔥 Calculate average waiting time
                const avgWait = Math.round(
                    waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
                );

                // Update UI
                document.getElementById('avg-wait-time').textContent = avgWait + "s";
                waitingChart.update('none');
            });
    }
    // --- Refresh every 5 seconds ---
    updateAnalysis();
    setTimeout(() => {
        updateWaitingChart();           // first call delayed by 500ms
        setInterval(updateWaitingChart, 8000);
    }, 500);
    setInterval(updateAnalysis, 5000);
});