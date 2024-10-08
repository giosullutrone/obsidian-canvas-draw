import {
    App,
    Plugin,
    WorkspaceLeaf,
    ItemView,
    Notice,
    setIcon,
    PluginSettingTab,
    Setting,
} from 'obsidian';

interface CanvasDrawingNodePluginSettings {
    numPens: number;
    penColors: string[];
    penSizes: number[];
    penSmoothness: number[];
    penOpacities: number[];
    strokesData: { [nodeId: string]: Stroke[] };
    drawableNodes: string[];
}

const DEFAULT_SETTINGS: CanvasDrawingNodePluginSettings = {
    numPens: 3,
    penColors: ['#000000', '#FF0000', '#00FF00'],
    penSizes: [5, 5, 5],
    penSmoothness: [0.5, 0.5, 0.5],
    penOpacities: [1.0, 1.0, 1.0],
    strokesData: {},
    drawableNodes: [],
};

class CanvasDrawingNodePluginSettingsTab extends PluginSettingTab {
    plugin: CanvasDrawingNodePlugin;

    constructor(app: App, plugin: CanvasDrawingNodePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Canvas Drawing Node Plugin Settings' });

        // Setting for Number of Pens
        new Setting(containerEl)
            .setName('Number of Pens')
            .setDesc('Define how many pens you want.')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.numPens)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.numPens = value;
                    // Adjust penColors, penSizes, and penSmoothness arrays based on numPens
                    while (this.plugin.settings.penColors.length < value) {
                        this.plugin.settings.penColors.push('#000000');        // Default to black
                        this.plugin.settings.penSizes.push(5);                // Default size
                        this.plugin.settings.penSmoothness.push(0.5);         // Default smoothness
                    }
                    while (this.plugin.settings.penColors.length > value) {
                        this.plugin.settings.penColors.pop();
                        this.plugin.settings.penSizes.pop();
                        this.plugin.settings.penSmoothness.pop();
                    }
                    await this.plugin.saveSettings();
                    this.display(); // Refresh the settings tab
                    this.plugin.refreshToolbar();
                }));

        // Settings for Each Pen's Color, Size, and Smoothness
        for (let i = 0; i < this.plugin.settings.numPens; i++) {
            // Pen Color
            new Setting(containerEl)
                .setName(`Pen ${i + 1} Color`)
                .setDesc(`Select color for Pen ${i + 1}.`)
                .addColorPicker(colorPicker => colorPicker
                    .setValue(this.plugin.settings.penColors[i])
                    .onChange(async (value) => {
                        this.plugin.settings.penColors[i] = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshToolbar();
                    }));

            // Pen Size
            new Setting(containerEl)
                .setName(`Pen ${i + 1} Size`)
                .setDesc(`Adjust size for Pen ${i + 1}.`)
                .addSlider(slider => slider
                    .setLimits(1, 50, 1)
                    .setValue(this.plugin.settings.penSizes[i])
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.penSizes[i] = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateDrawingCanvases();
                    }));

            // Pen Smoothness
            new Setting(containerEl)
                .setName(`Pen ${i + 1} Smoothness`)
                .setDesc(`Adjust smoothness for Pen ${i + 1}.`)
                .addSlider(slider => slider
                    .setLimits(0, 1, 0.01)
                    .setValue(this.plugin.settings.penSmoothness[i])
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.penSmoothness[i] = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateDrawingCanvases();
                    }));

            // Pen Opacity
            new Setting(containerEl)
                .setName(`Pen ${i + 1} Opacity`)
                .setDesc(`Adjust opacity for Pen ${i + 1}.`)
                .addSlider(slider => slider
                    .setLimits(0, 1, 0.01)
                    .setValue(this.plugin.settings.penOpacities[i])
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.penOpacities[i] = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateDrawingCanvases();
                    }));
        }
    }
}

export default class CanvasDrawingNodePlugin extends Plugin {
    settings: CanvasDrawingNodePluginSettings;
    selectedTool: 'eraser' | number | null = null; // 'eraser' or pen index
    drawingCanvases: Map<HTMLCanvasElement, DrawingCanvas> = new Map();

    async onload() {
        console.log('Loading Canvas Drawing Node plugin');

        // Load or initialize settings
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new CanvasDrawingNodePluginSettingsTab(this.app, this));

        // Add a command to make selected node(s) drawable
        this.addCommand({
            id: 'make-node-drawable',
            name: 'Make Selected Node Drawable',
            checkCallback: (checking: boolean) => {
                const canvasView = this.getActiveCanvasView();
                if (canvasView) {
                    if (!checking) {
                        this.makeSelectedNodesDrawable(canvasView);
                    }
                    return true;
                }
                return false;
            },
        });

        // Process existing canvas views
        this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
            this.addDrawingControlsToCanvas(leaf);
            this.initializeDrawableNodesInCanvas(leaf.view);
        });

        // Listen for layout changes to catch new canvas views
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
                    this.addDrawingControlsToCanvas(leaf);
                    this.initializeDrawableNodesInCanvas(leaf.view);
                });
            })
        );
    }

    async loadSettings() {
        // Load existing settings or use default
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // Ensure strokesData and drawableNodes are initialized
        if (!this.settings.strokesData) {
            this.settings.strokesData = {};
        }
        if (!this.settings.drawableNodes) {
            this.settings.drawableNodes = [];
        }

        // Ensure penColors, penSizes, penSmoothness, and penOpacities arrays match numPens
        while (this.settings.penColors.length < this.settings.numPens) {
            this.settings.penColors.push('#000000');
            this.settings.penSizes.push(5);
            this.settings.penSmoothness.push(0.5);
            this.settings.penOpacities.push(1.0);
        }
        while (this.settings.penColors.length > this.settings.numPens) {
            this.settings.penColors.pop();
            this.settings.penSizes.pop();
            this.settings.penSmoothness.pop();
            this.settings.penOpacities.pop();
        }
    }

    async saveSettings() {
        // Save all settings including strokesData and drawableNodes
        await this.saveData(this.settings);
    }

    // Method to save strokes data for a specific node
    async saveStrokes(nodeId: string, strokes: Stroke[]) {
        this.settings.strokesData[nodeId] = strokes;
        await this.saveSettings();
    }

    // Method to save drawable nodes list
    async saveDrawableNodes() {
        await this.saveSettings();
    }

    // Method to refresh the toolbar when settings change
    refreshToolbar() {
        this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
            this.addDrawingControlsToCanvas(leaf);
        });
    }

    // Method to update all DrawingCanvas instances with new settings
    updateDrawingCanvases() {
        this.drawingCanvases.forEach((drawingCanvasInstance) => {
            drawingCanvasInstance.redraw(); // Implement a redraw method if necessary
        });
    }

    // Helper method to get the active canvas view
    getActiveCanvasView(): any {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (canvasView && canvasView.getViewType() === 'canvas') {
            return canvasView;
        }
        return null;
    }

    // Method to make selected node(s) drawable and associate strokes data
    makeSelectedNodesDrawable(canvasView: any) {
        const canvas = canvasView.canvas;
        const selectedNodes: any[] = Array.from(canvas.selection);

        if (selectedNodes.length === 0) {
            new Notice('No nodes selected.');
            return;
        }

        selectedNodes.forEach((node: any) => {
            const nodeElement = node.contentEl; // Access the DOM element directly using contentEl

            if (nodeElement) {
                const nodeId = node.id; // Assumed: Each node has a unique ID
                if (!this.settings.drawableNodes.includes(nodeId)) {
                    this.settings.drawableNodes.push(nodeId); // Mark node as drawable
                }

                // Retrieve existing strokes or initialize as empty array
                const existingStrokes = this.settings.strokesData[nodeId] || [];
                this.initializeDrawingCanvas(canvasView, node, nodeElement, nodeId, existingStrokes);
            } else {
                console.error(`Failed to retrieve the contentEl for node ID: ${node.id}`);
            }
        });

        this.saveDrawableNodes(); // Persist the updated drawableNodes list
        canvas.requestSave();
    }

    // Method to initialize drawing canvas with nodeId and existing strokes
    initializeDrawingCanvas(
        canvasView: any,
        nodeData: any,
        nodeElement: HTMLElement,
        nodeId: string,
        strokes: Stroke[]
    ) {
        // Prevent multiple canvases in the same node
        if (nodeElement.querySelector('canvas.drawing-canvas')) {
            return; // Canvas already initialized
        }

        // Add relative positioning to the node element to ensure the canvas can be absolutely positioned within it
        nodeElement.style.position = 'relative';

        // Find the scrollable content element within the node
        const contentElement = nodeElement.querySelector('.canvas-node-content') || nodeElement;
        const scrollableElement = contentElement as HTMLElement;

        // Create the drawing canvas element
        const drawingCanvas = document.createElement('canvas');
        drawingCanvas.classList.add('drawing-canvas');
        drawingCanvas.width = scrollableElement.scrollWidth;
        drawingCanvas.height = scrollableElement.scrollHeight;
        drawingCanvas.style.position = 'absolute'; // Position the canvas absolutely within the content
        drawingCanvas.style.top = '0';
        drawingCanvas.style.left = '0';
        drawingCanvas.style.width = '100%';
        drawingCanvas.style.height = '100%';
        drawingCanvas.style.touchAction = 'none'; // Prevent touch scrolling while drawing
        drawingCanvas.style.zIndex = '10'; // Ensure the canvas is on top of the text

        // Append the drawing canvas to the scrollable content element
        scrollableElement.appendChild(drawingCanvas);

        // Pass nodeId and existing strokes to DrawingCanvas
        const drawingCanvasInstance = new DrawingCanvas(this, drawingCanvas, nodeId, strokes);
        this.drawingCanvases.set(drawingCanvas, drawingCanvasInstance);
    }

    // Method to initialize drawable nodes within a canvas view
    initializeDrawableNodesInCanvas(canvasView: any) {
        if (canvasView.getViewType() !== 'canvas') {
            return;
        }

        const canvas = canvasView.canvas;
        const allNodes: any[] = Array.from(canvas.nodes);

        allNodes.forEach((node: any) => {
            const nodeId = node.id;
            if (this.settings.drawableNodes.includes(nodeId)) {
                const nodeElement = node.contentEl;
                const existingStrokes = this.settings.strokesData[nodeId] || [];
                this.initializeDrawingCanvas(canvasView, node, nodeElement, nodeId, existingStrokes);
            }
        });
    }

    // Method to add drawing controls to the canvas toolbar
    addDrawingControlsToCanvas(leaf: WorkspaceLeaf) {
        const canvasView = leaf.view;
        if (canvasView.getViewType() !== 'canvas') {
            return;
        }

        const container = canvasView.containerEl;

        // Find the toolbar in the canvas view
        const toolbar = container.querySelector('.canvas-controls');

        if (toolbar) {
            // Remove existing drawing control group to refresh
            const existingGroup = toolbar.querySelector('.canvas-drawing-control-group');
            if (existingGroup) {
                existingGroup.remove();
            }

            // Create a new control group for the drawing controls
            const controlGroup = document.createElement('div');
            controlGroup.classList.add('canvas-control-group', 'canvas-drawing-control-group');

            // Text Button
            const textControlItem = document.createElement('div');
            textControlItem.classList.add('canvas-control-item');

            const textButton = document.createElement('button');
            textButton.type = 'button';
            textButton.classList.add('clickable-icon', 'view-action');
            setIcon(textButton, 'pencil'); // Use an appropriate icon

            textButton.setAttribute('aria-label', 'Text Tool');
            textButton.setAttribute('title', 'Text Tool');

            // Handle text button click
            textButton.addEventListener('click', (event) => {
                event.stopPropagation(); // Prevent event bubbling

                // Deselect any selected tool
                this.selectedTool = null;
                this.updateSelectedTool();
            });

            textControlItem.appendChild(textButton);
            controlGroup.appendChild(textControlItem);

            // Create Pen Buttons
            for (let i = 0; i < this.settings.numPens; i++) {
                const penControlItem = document.createElement('div');
                penControlItem.classList.add('canvas-control-item');

                const penButton = document.createElement('button');
                penButton.type = 'button';
                penButton.classList.add('clickable-icon', 'view-action');
                setIcon(penButton, 'brush'); // Use a brush icon for pens

                // Set the pen icon's color
                penButton.style.color = this.settings.penColors[i];

                penButton.setAttribute('aria-label', `Pen ${i + 1}`);
                penButton.setAttribute('title', `Pen ${i + 1}`);

                // Handle pen button click
                penButton.addEventListener('click', async (event) => {
                    event.stopPropagation(); // Prevent event bubbling

                    // Select this pen
                    this.selectedTool = i;
                    this.updateSelectedTool();
                });

                penControlItem.appendChild(penButton);
                controlGroup.appendChild(penControlItem);
            }

            // Eraser Button
            const eraserControlItem = document.createElement('div');
            eraserControlItem.classList.add('canvas-control-item');

            const eraserButton = document.createElement('button');
            eraserButton.type = 'button';
            eraserButton.classList.add('clickable-icon', 'view-action');
            setIcon(eraserButton, 'eraser'); // Use an eraser icon

            eraserButton.setAttribute('aria-label', 'Eraser');
            eraserButton.setAttribute('title', 'Eraser');

            // Handle eraser button click
            eraserButton.addEventListener('click', (event) => {
                event.stopPropagation(); // Prevent event bubbling

                // Select eraser
                this.selectedTool = 'eraser';
                this.updateSelectedTool();
            });

            eraserControlItem.appendChild(eraserButton);
            controlGroup.appendChild(eraserControlItem);

            // Add controls under the pens and eraser
            const controlsContainer = document.createElement('div');
            controlsContainer.classList.add('drawing-controls-container');
            controlsContainer.style.marginTop = '10px'; // Add some spacing

            // Color Picker Control
            const colorControlItem = document.createElement('div');
            colorControlItem.classList.add('control-item');

            const colorLabel = document.createElement('label');
            colorLabel.innerText = 'Color';
            colorLabel.style.display = 'block';
            colorLabel.style.fontSize = '12px';
            colorLabel.style.marginBottom = '2px';
            colorLabel.style.textAlign = 'center';

            const colorPickerInput = document.createElement('input');
            colorPickerInput.type = 'color';
            colorPickerInput.style.width = '40px';
            colorPickerInput.style.height = '25px';
            colorPickerInput.style.padding = '0';
            colorPickerInput.style.border = 'none';
            colorPickerInput.style.cursor = 'pointer';
            colorPickerInput.style.display = 'block';

            colorControlItem.appendChild(colorLabel);
            colorControlItem.appendChild(colorPickerInput);
            controlsContainer.appendChild(colorControlItem);

            // Pen Size Control
            const sizeControlItem = document.createElement('div');
            sizeControlItem.classList.add('control-item');

            const sizeLabel = document.createElement('label');
            sizeLabel.innerText = 'Size';
            sizeLabel.style.display = 'block';
            sizeLabel.style.fontSize = '12px';
            sizeLabel.style.marginBottom = '2px';
            sizeLabel.style.textAlign = 'center';

            const sizeInput = document.createElement('input');
            sizeInput.type = 'number';
            sizeInput.min = '1';
            sizeInput.max = '50';
            sizeInput.step = '1';
            sizeInput.style.width = '40px';
            sizeInput.style.padding = '2px';
            sizeInput.style.fontSize = '12px';
            sizeInput.style.boxSizing = 'border-box';
            sizeInput.style.display = 'block';

            sizeControlItem.appendChild(sizeLabel);
            sizeControlItem.appendChild(sizeInput);
            controlsContainer.appendChild(sizeControlItem);

            // Smoothness Control
            const smoothnessControlItem = document.createElement('div');
            smoothnessControlItem.classList.add('control-item');

            const smoothnessLabel = document.createElement('label');
            smoothnessLabel.innerText = 'Smooth';
            smoothnessLabel.style.display = 'block';
            smoothnessLabel.style.fontSize = '12px';
            smoothnessLabel.style.marginBottom = '2px';
            smoothnessLabel.style.textAlign = 'center';

            const smoothnessInput = document.createElement('input');
            smoothnessInput.type = 'number';
            smoothnessInput.min = '0';
            smoothnessInput.max = '1';
            smoothnessInput.step = '0.01';
            smoothnessInput.style.width = '40px';
            smoothnessInput.style.padding = '2px';
            smoothnessInput.style.fontSize = '12px';
            smoothnessInput.style.boxSizing = 'border-box';
            smoothnessInput.style.display = 'block';

            smoothnessControlItem.appendChild(smoothnessLabel);
            smoothnessControlItem.appendChild(smoothnessInput);
            controlsContainer.appendChild(smoothnessControlItem);

            // Opacity Control
            const opacityControlItem = document.createElement('div');
            opacityControlItem.classList.add('control-item');

            const opacityLabel = document.createElement('label');
            opacityLabel.innerText = 'Opacity';
            opacityLabel.style.display = 'block';
            opacityLabel.style.fontSize = '12px';
            opacityLabel.style.marginBottom = '2px';
            opacityLabel.style.textAlign = 'center';
            
            const opacityInput = document.createElement('input');
            opacityInput.type = 'number';
            opacityInput.min = '0';
            opacityInput.max = '1';
            opacityInput.step = '0.01';
            opacityInput.style.width = '40px';
            opacityInput.style.padding = '2px';
            opacityInput.style.fontSize = '12px';
            opacityInput.style.boxSizing = 'border-box';
            opacityInput.style.display = 'block';

            opacityControlItem.appendChild(opacityLabel);
            opacityControlItem.appendChild(opacityInput);
            controlsContainer.appendChild(opacityControlItem);

            controlGroup.appendChild(controlsContainer);
            
            // Append the control group to the toolbar
            toolbar.appendChild(controlGroup);

            // Disable controls if no pen is selected
            const updateControls = () => {
                const selectedTool = this.selectedTool;
                if (typeof selectedTool === 'number') {
                    // Pen is selected
                    const penIndex = selectedTool;
                    // Enable controls
                    colorPickerInput.disabled = false;
                    sizeInput.disabled = false;
                    smoothnessInput.disabled = false;
                    opacityInput.disabled = false;
            
                    // Set controls to pen's properties
                    colorPickerInput.value = this.settings.penColors[penIndex];
                    sizeInput.value = this.settings.penSizes[penIndex].toString();
                    smoothnessInput.value = this.settings.penSmoothness[penIndex].toString();
                    opacityInput.value = this.settings.penOpacities[penIndex].toString();

                } else if (selectedTool === 'eraser') {
                    // Eraser is selected
                    // Disable color picker, enable others if needed
                    colorPickerInput.disabled = true;
                    sizeInput.disabled = true;
                    smoothnessInput.disabled = true;

                } else {
                    // Disable controls for eraser or no tool selected
                    colorPickerInput.disabled = true;
                    sizeInput.disabled = true;
                    smoothnessInput.disabled = true;
                    opacityInput.disabled = true;
                }
            };

            // Call updateControls initially
            updateControls();

            // Update controls when selectedTool changes
            this.updateSelectedTool = () => {
                // Update pen buttons
                const buttons = controlGroup.querySelectorAll('button');
                // Text button is the first button
                const textButton = buttons[0];
                if (this.selectedTool === null) {
                    textButton.classList.add('active');
                } else {
                    textButton.classList.remove('active');
                }

                // Pen buttons
                for (let i = 0; i < this.settings.numPens; i++) {
                    const penButton = buttons[i + 1]; // +1 because of the text button
                    if (this.selectedTool === i) {
                        penButton.classList.add('active');
                    } else {
                        penButton.classList.remove('active');
                    }
                }

                // Eraser button
                const eraserButton = buttons[this.settings.numPens + 1];
                if (this.selectedTool === 'eraser') {
                    eraserButton.classList.add('active');
                } else {
                    eraserButton.classList.remove('active');
                }

                updateControls();
                this.updateDrawingCanvasPointerEvents();
            };

            // Event listeners to update pen properties when controls change
            colorPickerInput.addEventListener('input', async () => {
                if (typeof this.selectedTool === 'number') {
                    const penIndex = this.selectedTool;
                    this.settings.penColors[penIndex] = colorPickerInput.value;
                    await this.saveSettings();
                    // Update pen button color
                    const penButton = controlGroup.querySelectorAll('button')[penIndex + 1]; // +1 because of the text button
                    penButton.style.color = colorPickerInput.value;
                    this.updateDrawingCanvases();
                }
            });

            sizeInput.addEventListener('change', async () => {
                if (typeof this.selectedTool === 'number') {
                    const value = parseInt(sizeInput.value);
                    if (!isNaN(value) && value >= 1 && value <= 50) {
                        const penIndex = this.selectedTool;
                        this.settings.penSizes[penIndex] = value;
                        await this.saveSettings();
                        this.updateDrawingCanvases();
                    } else {
                        new Notice('Size must be between 1 and 50.');
                        sizeInput.value = this.settings.penSizes[this.selectedTool as number].toString();
                    }
                }
            });

            smoothnessInput.addEventListener('change', async () => {
                if (typeof this.selectedTool === 'number') {
                    const value = parseFloat(smoothnessInput.value);
                    if (!isNaN(value) && value >= 0 && value <= 1) {
                        const penIndex = this.selectedTool;
                        this.settings.penSmoothness[penIndex] = value;
                        await this.saveSettings();
                        this.updateDrawingCanvases();
                    } else {
                        new Notice('Smoothness must be between 0 and 1.');
                        smoothnessInput.value = this.settings.penSmoothness[this.selectedTool as number].toString();
                    }
                }
            });

            opacityInput.addEventListener('change', async () => {
                if (typeof this.selectedTool === 'number') {
                    const value = parseFloat(opacityInput.value);
                    if (!isNaN(value) && value >= 0 && value <= 1) {
                        const penIndex = this.selectedTool;
                        this.settings.penOpacities[penIndex] = value;
                        await this.saveSettings();
                        this.updateDrawingCanvases();
                    } else {
                        new Notice('Opacity must be between 0 and 1.');
                        opacityInput.value = this.settings.penOpacities[this.selectedTool as number].toString();
                    }
                }
            });
        }
    }

    // Method to update the selected tool's UI
    updateSelectedTool() {
        // This method will be overridden in addDrawingControlsToCanvas
    }

    // Method to update pointer-events of drawing canvases based on selected tool
    updateDrawingCanvasPointerEvents() {
        this.drawingCanvases.forEach((drawingCanvasInstance) => {
            if (this.selectedTool === null) {
                drawingCanvasInstance.canvas.style.pointerEvents = 'none';
            } else {
                drawingCanvasInstance.canvas.style.pointerEvents = 'auto';
            }
        });
    }

    onunload() {
        console.log('Unloading Canvas Drawing Node plugin');
    }
}

class DrawingCanvas {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    plugin: CanvasDrawingNodePlugin;
    strokes: Stroke[];
    undoneStrokes: Stroke[];
    currentStroke: Stroke | null;
    nodeId: string; // Reference to the node's unique ID
    resizeObserver: ResizeObserver;

    constructor(
        plugin: CanvasDrawingNodePlugin,
        canvas: HTMLCanvasElement,
        nodeId: string,          // Node ID parameter
        existingStrokes: Stroke[] // Existing strokes parameter
    ) {
        this.canvas = canvas;
        this.plugin = plugin;
        this.nodeId = nodeId; // Initialize nodeId
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2d context for canvas');
        }
        this.ctx = ctx;
        this.strokes = existingStrokes; // Initialize strokes with existing data
        this.undoneStrokes = [];
        this.currentStroke = null;

        // Event listeners
        this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
        this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
        this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
        this.canvas.addEventListener('pointerleave', this.onPointerLeave.bind(this));

        // Observe nodeElement resize
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                this.onResize(width, height);
            }
        });
        this.resizeObserver.observe(this.canvas.parentElement!); // Assuming the canvas is appended to the nodeElement

        // Render existing strokes upon initialization
        this.redraw();
    }

    onResize(width: number, height: number) {
        // Update canvas size
        this.canvas.width = width;
        this.canvas.height = height;

        // Redraw strokes
        this.redraw();
    }

    onPointerDown(e: PointerEvent) {
        if (this.plugin.selectedTool === null) {
            return; // Do nothing if no tool is selected
        }

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const scrollLeft = this.canvas.parentElement?.scrollLeft || 0;
        const scrollTop = this.canvas.parentElement?.scrollTop || 0;

        const point: Point = {
            x: (e.clientX - rect.left + scrollLeft) * scaleX,
            y: (e.clientY - rect.top + scrollTop) * scaleY,
        };

        if (this.plugin.selectedTool === 'eraser') {
            this.eraseStrokeAtPoint(point);
        } else if (typeof this.plugin.selectedTool === 'number') {
            const penIndex = this.plugin.selectedTool;
            const penColor = this.plugin.settings.penColors[penIndex];
            const penSize = this.plugin.settings.penSizes[penIndex];
            const penSmoothness = this.plugin.settings.penSmoothness[penIndex];
            const penOpacity = this.plugin.settings.penOpacities[penIndex];
            this.currentStroke = {
                color: penColor,
                size: penSize,
                smoothing: penSmoothness,
                opacity: penOpacity,
                points: [point],
            };
        }
    }

    onPointerMove(e: PointerEvent) {
        if (this.plugin.selectedTool === null) {
            return; // Do nothing if no tool is selected
        }

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const scrollLeft = this.canvas.parentElement?.scrollLeft || 0;
        const scrollTop = this.canvas.parentElement?.scrollTop || 0;

        const point: Point = {
            x: (e.clientX - rect.left + scrollLeft) * scaleX,
            y: (e.clientY - rect.top + scrollTop) * scaleY,
        };

        if (this.currentStroke) {
            this.currentStroke.points.push(point);
            this.redraw();
        } else if (this.plugin.selectedTool === 'eraser' && e.buttons === 1) {
            // Only erase when the mouse button is pressed
            this.eraseStrokeAtPoint(point);
        }
    }

    onPointerUp() {
        if (this.currentStroke) {
            this.strokes.push(this.currentStroke);
            this.currentStroke = null;
            this.undoneStrokes = []; // Clear redo stack
            this.redraw();

            // Save strokes after adding a new stroke
            this.plugin.saveStrokes(this.nodeId, this.strokes);
        }
    }

    onPointerLeave() {
        if (this.currentStroke) {
            this.strokes.push(this.currentStroke);
            this.currentStroke = null;
            this.undoneStrokes = []; // Clear redo stack
            this.redraw();

            // Save strokes after adding a new stroke
            this.plugin.saveStrokes(this.nodeId, this.strokes);
        }
    }

    eraseStrokeAtPoint(point: Point) {
        // Erase any stroke that the point touches
        const eraserSize = 10; // Fixed eraser size; you can make this configurable
        const newStrokes = this.strokes.filter((stroke) => {
            return !stroke.points.some((strokePoint) => {
                const dx = strokePoint.x - point.x;
                const dy = strokePoint.y - point.y;
                return Math.sqrt(dx * dx + dy * dy) <= eraserSize;
            });
        });
        if (newStrokes.length !== this.strokes.length) {
            this.strokes = newStrokes;
            this.redraw();

            // Save strokes after erasing
            this.plugin.saveStrokes(this.nodeId, this.strokes);
        }
    }

    redraw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Redraw all strokes
        this.strokes.forEach((stroke) => {
            this.drawStroke(stroke);
        });

        // Draw current stroke
        if (this.currentStroke) {
            this.drawStroke(this.currentStroke);
        }
    }

    drawStroke(stroke: Stroke) {
        if (stroke.points.length < 2) return;

        this.ctx.save();

        // Ensure lineCap and lineJoin are set to 'round'
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.ctx.lineWidth = stroke.size;
        this.ctx.strokeStyle = stroke.color;
        this.ctx.globalAlpha = stroke.opacity;

        this.ctx.beginPath();

        const points = stroke.points;
        const smoothing = stroke.smoothing;

        this.ctx.moveTo(points[0].x, points[0].y);

        for (let i = 0; i < points.length - 1; i++) {
            const curr = points[i];
            const next = points[i + 1];

            const cpx = curr.x + (next.x - curr.x) * smoothing;
            const cpy = curr.y + (next.y - curr.y) * smoothing;

            this.ctx.quadraticCurveTo(curr.x, curr.y, cpx, cpy);
        }

        // Draw the last line segment
        const lastPoint = points[points.length - 1];
        this.ctx.lineTo(lastPoint.x, lastPoint.y);

        this.ctx.stroke();

        this.ctx.restore();
    }
}

interface Point {
    x: number;
    y: number;
}

interface Stroke {
    color: string;
    size: number;
    smoothing: number;
    opacity: number;
    points: Point[];
}
