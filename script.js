document.addEventListener('DOMContentLoaded', function () {
  const uploadArea = document.getElementById('uploadArea');
  const imageUpload = document.getElementById('imageUpload');
  const canvas = document.getElementById('heatmapCanvas');
  const ctx = canvas.getContext('2d');
  const tableBody = document.getElementById('tableBody');
  const exportBtn = document.getElementById('exportBtn');
  const exportImageBtn = document.getElementById('exportImageBtn');
  const tooltip = document.getElementById('tooltip');
  const sampleBtn = document.getElementById('sampleBtn');
  const brushSizeSlider = document.getElementById('brushSize');
  const brushSizeValue = document.getElementById('brushSizeValue');
  const temperatureSlider = document.getElementById('temperature');
  const tempValue = document.getElementById('tempValue');
  const zoneCounterDisplay = document.getElementById('zoneCounter');
  const pointCounter = document.getElementById('pointCounter');
  const fpsCounter = document.getElementById('fpsCounter');
  const minTempInput = document.getElementById('minTemp');
  const maxTempInput = document.getElementById('maxTemp');
  const legendLabelsContainer = document.getElementById('legendLabels');
  const importBtn = document.getElementById('importBtn');
  const undoBtn = document.getElementById('undoBtn');

  let isDrawing = false;
  let dataStrokes = [];
  let currentStrokePoints = [];
  let currentImage = null;
  let currentBrushSize = 30;
  let currentTemp = 25;
  let selectedStrokeId = null;
  let zoneCounter = 1;
  let history = [];
  const MAX_HISTORY = 50;
  const TOOLTIP_OFFSET_Y = -35;
  let minTemp = 0;
  let maxTemp = 100;
  const MIN_POINT_DISTANCE_SQ = 10 * 10;
  const heatmapTempCanvas = document.createElement('canvas');
  const heatmapTempCtx = heatmapTempCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  const drawingPreviewCanvas = document.createElement('canvas');
  const drawingPreviewCtx = drawingPreviewCanvas.getContext('2d');

  brushSizeSlider.value = currentBrushSize;
  brushSizeValue.textContent = `${currentBrushSize}px`;
  tempValue.textContent = `${currentTemp}°C`;
  canvas.width = 800;
  canvas.height = 600;
  loadSampleData();
  updateLegend();
  requestAnimationFrame(updateFpsCounter);
  setInterval(updatePerformanceStats, 1000);
  uploadArea.addEventListener('click', () => imageUpload.click());
  imageUpload.addEventListener('change', handleImageUpload);
  document.getElementById('clearBtn').addEventListener('click', clearCanvas);
  exportBtn.addEventListener('click', exportData);
  exportImageBtn.addEventListener('click', exportImage);
  sampleBtn.addEventListener('click', loadSampleData);
  minTempInput.addEventListener('change', handleTempRangeChange);
  maxTempInput.addEventListener('change', handleTempRangeChange);
  brushSizeSlider.addEventListener('input', (e) => {
    currentBrushSize = parseInt(e.target.value);
    brushSizeValue.textContent = `${currentBrushSize}px`;
  });
  temperatureSlider.addEventListener('input', (e) => {
    currentTemp = parseFloat(e.target.value);
    tempValue.textContent = `${currentTemp.toFixed(1)}°C`;
  });
  importBtn.addEventListener('click', handleImport);
  undoBtn.addEventListener('click', undoLastAction);

  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', handleInteraction);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', () => {
    stopDrawing();
    tooltip.style.display = 'none';
  });
  canvas.addEventListener('touchstart', startDrawing, { passive: false });
  canvas.addEventListener('touchmove', handleInteraction, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);

  tableBody.addEventListener('click', handleTableClick);
  tableBody.addEventListener('input', handleTableSliderInput);
  tableBody.addEventListener('change', handleTableInputChange);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.data-table')) {
      if (selectedStrokeId !== null) {
        selectedStrokeId = null;
        updateTable();
        redrawCanvas();
      }
    }
  });

  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        currentImage = img;
        const maxSize = 1200;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }
        [canvas.width, canvas.height] = [width, height];
        [heatmapTempCanvas.width, heatmapTempCanvas.height] = [width, height];
        [drawingPreviewCanvas.width, drawingPreviewCanvas.height] = [
          width,
          height,
        ];
        clearCanvas();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  function getEventCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
  }

  function startDrawing(e) {
    if (e.type.startsWith('touch')) e.preventDefault();
    saveHistory();
    isDrawing = true;

    const [x, y] = getEventCoordinates(e);
    const newPoint = { x, y };

    const selectedStroke = dataStrokes.find((s) => s.id === selectedStrokeId);

    if (selectedStroke) {
      currentStrokePoints = [...selectedStroke.points, newPoint];
    } else {
      currentStrokePoints = [newPoint];
      selectedStrokeId = null;
    }
  }

  function handleInteraction(e) {
    if (isDrawing) draw(e);
    else handleCanvasHover(e);
  }

  function draw(e) {
    if (e.type.startsWith('touch')) e.preventDefault();
    if (!isDrawing) return;
    requestAnimationFrame(() => {
      if (currentStrokePoints.length === 0) return;
      const [x, y] = getEventCoordinates(e);
      const lastPoint = currentStrokePoints[currentStrokePoints.length - 1];
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;
      if (dx * dx + dy * dy > MIN_POINT_DISTANCE_SQ) {
        currentStrokePoints.push({ x, y });
      }
      drawingPreviewCtx.clearRect(
        0,
        0,
        drawingPreviewCanvas.width,
        drawingPreviewCanvas.height
      );
      drawStrokeOnContext(drawingPreviewCtx, {
        points: currentStrokePoints,
        temp: currentTemp,
        brushSize: currentBrushSize,
      });
      redrawCanvas();
    });
  }

  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentStrokePoints.length > 0) addStroke();
    drawingPreviewCtx.clearRect(
      0,
      0,
      drawingPreviewCanvas.width,
      drawingPreviewCanvas.height
    );
    redrawCanvas();
  }

  function addStroke() {
    if (selectedStrokeId) {
      const stroke = dataStrokes.find((s) => s.id === selectedStrokeId);
      if (stroke) {
        stroke.points = [...currentStrokePoints];
        stroke.temp = currentTemp;
        stroke.brushSize = currentBrushSize;
      }
    } else {
      const stroke = {
        id: Date.now(),
        name: `Zone ${zoneCounter++}`,
        points: [...currentStrokePoints],
        temp: currentTemp,
        brushSize: currentBrushSize,
      };
      dataStrokes.push(stroke);
      selectedStrokeId = stroke.id;
    }
    currentStrokePoints = [];
    updateTable();
    redrawCanvas();
  }

  function handleImport() {
    const importModal = document.getElementById('importModal');
    const closeModalBtn = importModal.querySelector('.close-btn');
    const cancelBtn = importModal.querySelector('.cancel-btn');
    const importDataBtn = importModal.querySelector('.import-btn');
    const dataInput = document.getElementById('dataInput');

    const closeModal = () => {
      importModal.classList.remove('active');
      setTimeout(() => {
        importModal.style.display = 'none';
        dataInput.value = '';
      }, 300);

      closeModalBtn.removeEventListener('click', closeModal);
      cancelBtn.removeEventListener('click', closeModal);
      importDataBtn.removeEventListener('click', importDataHandler);
      importModal.removeEventListener('click', outsideClickHandler);
    };

    const importDataHandler = () => {
      const content = dataInput.value.trim();
      if (!content) {
        alert('The text area is empty. Please paste your data first.');
        return;
      }

      const lines = content.split('\n');
      const importTimestamp = Date.now();
      let firstImportedStrokeId = null;

      lines.forEach((line, index) => {
        const [zone, temp] = line.split(',');
        if (zone && temp) {
          const temperature = parseFloat(temp.trim());
          if (!isNaN(temperature)) {
            const newStrokeId = importTimestamp + index;
            const newStroke = {
              id: newStrokeId,
              name: zone.trim(),
              temp: temperature,
              brushSize: currentBrushSize,
              points: [],
            };
            dataStrokes.push(newStroke);
            if (!firstImportedStrokeId) {
              firstImportedStrokeId = newStrokeId;
            }
          }
        }
      });

      if (firstImportedStrokeId) {
        handleRowSelection(firstImportedStrokeId);
      }

      zoneCounter = dataStrokes.length + 1;
      updateTable();
      redrawCanvas();
      saveHistory();
      closeModal();
    };

    const outsideClickHandler = (e) => {
      if (e.target === importModal) {
        closeModal();
      }
    };

    closeModalBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    importDataBtn.addEventListener('click', importDataHandler);
    importModal.addEventListener('click', outsideClickHandler);

    importModal.style.display = 'flex';
    setTimeout(() => {
      importModal.classList.add('active');
      dataInput.focus();
    }, 10);
  }

  function saveHistory() {
    history.push({
      strokes: JSON.parse(JSON.stringify(dataStrokes)),
      selectedStrokeId: selectedStrokeId,
      zoneCounter: zoneCounter,
    });

    if (history.length > MAX_HISTORY) {
      history.shift();
    }
  }

  function undoLastAction() {
    if (history.length === 0) return;

    const prevState = history.pop();
    dataStrokes = prevState.strokes;
    selectedStrokeId = prevState.selectedStrokeId;
    zoneCounter = prevState.zoneCounter;

    updateTable();
    redrawCanvas();

    if (dataStrokes.length === 0 && history.length > 0) {
      history = [];
    }
  }

  function handleCanvasHover(e) {
    const [x, y] = getEventCoordinates(e);
    let hoveredStroke = null;
    let minDistance = Infinity;
    for (const stroke of dataStrokes) {
      for (const point of stroke.points) {
        const distance = Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2);
        if (distance < stroke.brushSize / 2 && distance < minDistance) {
          minDistance = distance;
          hoveredStroke = stroke;
        }
      }
    }
    if (hoveredStroke) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY + TOOLTIP_OFFSET_Y}px`;
      tooltip.textContent = `${
        hoveredStroke.name
      }: ${hoveredStroke.temp.toFixed(1)}°C`;
    } else {
      tooltip.style.display = 'none';
    }
  }

  function redrawCanvas() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentImage)
      ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
    else {
      ctx.fillStyle = '#1e1f22';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    drawHeatmap();
    if (isDrawing) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(drawingPreviewCanvas, 0, 0);
    }
  }

  function drawHeatmap() {
    if (dataStrokes.length === 0) return;
    heatmapTempCtx.clearRect(
      0,
      0,
      heatmapTempCanvas.width,
      heatmapTempCanvas.height
    );
    for (const stroke of dataStrokes)
      drawStrokeOnContext(heatmapTempCtx, stroke);
    heatmapTempCtx.filter = 'blur(35px)';
    heatmapTempCtx.drawImage(heatmapTempCanvas, 0, 0);
    heatmapTempCtx.filter = 'none';
    ctx.globalCompositeOperation = 'color-dodge';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(heatmapTempCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
  }

  function getColorForTemperature(temp) {
    let t = (temp - minTemp) / (maxTemp - minTemp);
    t = Math.max(0, Math.min(1, t));
    let r, g, b;
    if (t < 0.25) {
      r = 0;
      g = t * 4 * 255;
      b = 255;
    } else if (t < 0.5) {
      r = 0;
      g = 255;
      b = 255 - (t - 0.25) * 4 * 255;
    } else if (t < 0.75) {
      r = (t - 0.5) * 4 * 255;
      g = 255;
      b = 0;
    } else {
      r = 255;
      g = 255 - (t - 0.75) * 4 * 255;
      b = 0;
    }
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }

  function drawStrokeOnContext(targetCtx, stroke) {
    if (stroke.points.length === 0) return;

    targetCtx.strokeStyle = getColorForTemperature(stroke.temp);
    targetCtx.lineWidth = stroke.brushSize;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    targetCtx.beginPath();
    targetCtx.moveTo(stroke.points[0].x, stroke.points[0].y);

    for (let i = 1; i < stroke.points.length; i++) {
      targetCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }

    targetCtx.stroke();
  }

  function updateTable() {
    tableBody.innerHTML = '';
    dataStrokes.sort((a, b) => a.id - b.id);
    for (const stroke of dataStrokes) {
      const row = document.createElement('tr');
      row.dataset.strokeId = stroke.id;
      if (stroke.id === selectedStrokeId)
        row.style.backgroundColor = 'rgba(88, 101, 242, 0.3)';
      const fahrenheit = (stroke.temp * 9) / 5 + 32;
      row.innerHTML = `<td><input type="text" value="${
        stroke.name
      }" class="zone-name-input" data-id="${
        stroke.id
      }"></td><td class="temp-cell"><input type="range" min="${minTemp}" max="${maxTemp}" step="0.1" value="${
        stroke.temp
      }" class="temp-slider" data-id="${
        stroke.id
      }"><div class="temp-input-group"><input type="number" min="${minTemp}" max="${maxTemp}" step="0.1" value="${stroke.temp.toFixed(
        1
      )}" class="temp-input" data-id="${
        stroke.id
      }"><span>°C</span></div></td><td class="fahrenheit-cell">${fahrenheit.toFixed(
        1
      )}°F</td><td class="action-cell"><button class="action-btn" data-action="delete" data-id="${
        stroke.id
      }"><i class="fas fa-trash"></i></button></td>`;
      tableBody.appendChild(row);
    }
  }

  function handleTableSliderInput(e) {
    if (e.target.classList.contains('temp-slider')) {
      const id = parseFloat(e.target.dataset.id);
      const newTemp = parseFloat(e.target.value);
      if (!isNaN(newTemp) && !isNaN(id)) {
        updateStrokeUI(id, newTemp);
      }
    }
  }

  function handleTableInputChange(e) {
    saveHistory();
    const target = e.target;
    const id = parseInt(target.dataset.id);
    const stroke = dataStrokes.find((s) => s.id === id);
    if (!stroke) return;

    if (target.classList.contains('zone-name-input')) {
      stroke.name = target.value;
    } else if (target.classList.contains('temp-input')) {
      let newTemp = parseFloat(target.value);
      if (isNaN(newTemp)) {
        target.value = stroke.temp.toFixed(1);
        return;
      }
      if (stroke.id === selectedStrokeId) {
        currentTemp = newTemp;
        temperatureSlider.value = currentTemp;
        tempValue.textContent = `${currentTemp.toFixed(1)}°C`;
      }
      updateStrokeUI(id, newTemp);
    }
  }

  function updateStrokeUI(id, newTemp) {
    const stroke = dataStrokes.find((s) => s.id === id);
    if (!stroke) return;
    stroke.temp = newTemp;
    const row = tableBody.querySelector(`tr[data-stroke-id="${id}"]`);
    if (row) {
      row.querySelector('.temp-slider').value = stroke.temp;
      row.querySelector('.temp-input').value = stroke.temp.toFixed(1);
      row.querySelector('.fahrenheit-cell').textContent = `${(
        (stroke.temp * 9) / 5 +
        32
      ).toFixed(1)}°F`;
    }
    redrawCanvas();
  }

  function handleRowSelection(newSelectedId) {
    selectedStrokeId = newSelectedId;

    const selectedStroke = dataStrokes.find((s) => s.id === newSelectedId);
    if (selectedStroke) {
      currentTemp = selectedStroke.temp;
      temperatureSlider.value = currentTemp;
      tempValue.textContent = `${currentTemp.toFixed(1)}°C`;

      currentBrushSize = selectedStroke.brushSize;
      brushSizeSlider.value = currentBrushSize;
      brushSizeValue.textContent = `${currentBrushSize}px`;
    }

    updateTable();
    redrawCanvas();
  }

  function handleTableClick(e) {
    e.stopPropagation();
    const button = e.target.closest('button.action-btn');
    const row = e.target.closest('tr');

    if (button) {
      saveHistory();
      const strokeId = parseInt(button.dataset.id);
      dataStrokes = dataStrokes.filter((s) => s.id !== strokeId);
      if (selectedStrokeId === strokeId) {
        selectedStrokeId = null;
      }
      updateTable();
      redrawCanvas();
      return;
    }

    if (row) {
      const newSelectedId = parseInt(row.dataset.strokeId);
      if (selectedStrokeId !== newSelectedId) {
        selectedStrokeId = newSelectedId;

        const selectedStroke = dataStrokes.find((s) => s.id === newSelectedId);
        if (selectedStroke) {
          currentTemp = selectedStroke.temp;
          temperatureSlider.value = currentTemp;
          tempValue.textContent = `${currentTemp.toFixed(1)}°C`;

          currentBrushSize = selectedStroke.brushSize;
          brushSizeSlider.value = currentBrushSize;
          brushSizeValue.textContent = `${currentBrushSize}px`;
        }

        updateTable();
        redrawCanvas();
      }
    }
  }

  function clearCanvas() {
    saveHistory();
    dataStrokes = [];
    selectedStrokeId = null;
    zoneCounter = 1;
    redrawCanvas();
    updateTable();
  }

  function exportImage() {
    if (!currentImage && dataStrokes.length === 0) {
      alert('No thermal data to export! Please add data points first.');
      return;
    }

    redrawCanvas();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const stroke of dataStrokes) {
      if (stroke.points.length === 0) continue;
      let avgX = 0,
        avgY = 0;
      stroke.points.forEach((p) => {
        avgX += p.x;
        avgY += p.y;
      });
      avgX /= stroke.points.length;
      avgY /= stroke.points.length;
      const text = `${stroke.name}: ${stroke.temp.toFixed(1)}°C`;
      ctx.font = 'bold 15px Segoe UI';
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 4;
      ctx.strokeText(text, avgX, avgY);
      ctx.fillStyle = 'white';
      ctx.fillText(text, avgX, avgY);
    }
    const link = document.createElement('a');
    link.setAttribute('href', canvas.toDataURL('image/png'));
    link.setAttribute('download', 'heatmap_report.png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    redrawCanvas();
  }

  function exportData() {
    if (dataStrokes.length === 0) {
      alert('No thermal data to export!');
      return;
    }

    let maxNameLength = 'Zone Name'.length;
    let maxTempLength = 'Temp (C)'.length;

    dataStrokes.forEach((stroke) => {
      maxNameLength = Math.max(maxNameLength, stroke.name.length);
      maxTempLength = Math.max(maxTempLength, stroke.temp.toFixed(1).length);
    });

    let txtContent =
      '+' +
      '-'.repeat(maxNameLength + 2) +
      '+' +
      '-'.repeat(maxTempLength + 2) +
      '+\n';
    txtContent +=
      '| ' +
      'Zone Name'.padEnd(maxNameLength) +
      ' | ' +
      'Temp (C)'.padEnd(maxTempLength) +
      ' |\n';
    txtContent +=
      '+' +
      '-'.repeat(maxNameLength + 2) +
      '+' +
      '-'.repeat(maxTempLength + 2) +
      '+\n';

    dataStrokes.forEach((stroke) => {
      txtContent +=
        '| ' +
        stroke.name.padEnd(maxNameLength) +
        ' | ' +
        stroke.temp.toFixed(1).padEnd(maxTempLength) +
        ' |\n';
    });

    txtContent +=
      '+' +
      '-'.repeat(maxNameLength + 2) +
      '+' +
      '-'.repeat(maxTempLength + 2) +
      '+\n';

    const blob = new Blob([txtContent], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'thermal_data_report.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function loadSampleData() {
    clearCanvas();
    currentImage = null;
    [canvas.width, canvas.height] = [800, 600];
    [heatmapTempCanvas.width, heatmapTempCanvas.height] = [800, 600];
    [drawingPreviewCanvas.width, drawingPreviewCanvas.height] = [800, 600];
    dataStrokes = [
      {
        id: Date.now() + 1,
        name: 'Hot Zone',
        temp: 95.5,
        brushSize: 50,
        points: [
          { x: 350, y: 300 },
          { x: 400, y: 320 },
          { x: 450, y: 280 },
        ],
      },
      {
        id: Date.now() + 2,
        name: 'Warm Area',
        temp: 65.2,
        brushSize: 80,
        points: [{ x: 550, y: 450 }],
      },
      {
        id: Date.now() + 3,
        name: 'Cool Spot',
        temp: 15.8,
        brushSize: 60,
        points: [
          { x: 200, y: 200 },
          { x: 220, y: 240 },
        ],
      },
    ];
    if (dataStrokes.length > 0) handleRowSelection(dataStrokes[0].id);
    redrawCanvas();
    updateTable();
  }

  function handleTempRangeChange() {
    minTemp = parseFloat(minTempInput.value);
    maxTemp = parseFloat(maxTempInput.value);
    if (isNaN(minTemp)) minTemp = 0;
    if (isNaN(maxTemp)) maxTemp = 100;
    if (minTemp >= maxTemp) {
      minTemp = maxTemp - 1;
      minTempInput.value = minTemp;
    }
    temperatureSlider.min = minTemp;
    temperatureSlider.max = maxTemp;
    if (parseFloat(temperatureSlider.value) < minTemp)
      temperatureSlider.value = minTemp;
    if (parseFloat(temperatureSlider.value) > maxTemp)
      temperatureSlider.value = maxTemp;
    updateLegend();
    redrawCanvas();
    updateTable();
  }

  function updateLegend() {
    legendLabelsContainer.innerHTML = '';
    const range = maxTemp - minTemp;
    [0, 0.25, 0.5, 0.75, 1].forEach((factor) => {
      const val = minTemp + range * factor;
      const label = document.createElement('span');
      label.textContent = `${val.toFixed(0)}°C`;
      legendLabelsContainer.appendChild(label);
    });
  }

  function updatePerformanceStats() {
    zoneCounterDisplay.textContent = dataStrokes.length;
    const totalPoints = dataStrokes.reduce(
      (acc, s) => acc + s.points.length,
      0
    );
    pointCounter.textContent = totalPoints;
  }

  let frameCount = 0,
    lastFpsUpdate = 0;
  function updateFpsCounter(timestamp) {
    frameCount++;
    if (timestamp >= lastFpsUpdate + 1000) {
      fpsCounter.textContent = frameCount;
      frameCount = 0;
      lastFpsUpdate = timestamp;
    }
    requestAnimationFrame(updateFpsCounter);
  }

  saveHistory();
});
