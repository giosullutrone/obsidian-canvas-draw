import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    TFile,
    ItemView,
    MarkdownView
} from 'obsidian';
import * as natural from 'natural'; // Natural language processing library

// Define the interface for plugin settings
interface CanvasChatPluginSettings {
    vllmApiUrl: string; // URL of the vLLM API server (e.g., http://localhost:8000)
    K: number; // Number of similar chunks to retrieve
    userHighlightColor: string; // Highlight color for user messages
    assistantHighlightColor: string; // Highlight color for assistant messages
}

// Default settings for the plugin
const DEFAULT_SETTINGS: CanvasChatPluginSettings = {
    vllmApiUrl: 'http://localhost:8000',
    K: 5,
    userHighlightColor: '#FF5582A6',
    assistantHighlightColor: '#82FF55A6',
};

/*######################################################
# Plugin Classes
######################################################*/

// Class for creating the settings tab in the plugin settings
class CanvasChatPluginSettingTab extends PluginSettingTab {
    plugin: CanvasChatPlugin;

    constructor(app: App, plugin: CanvasChatPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // Create a header for the settings tab
        containerEl.createEl('h2', { text: 'Canvas Chat Plugin Settings' });

        // Setting for vLLM API URL
        new Setting(containerEl)
            .setName('vLLM API URL')
            .setDesc('Enter the URL of your vLLM server (e.g., http://localhost:11434)')
            .addText((text) =>
                text
                    .setPlaceholder('http://localhost:11434')
                    .setValue(this.plugin.settings.vllmApiUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.vllmApiUrl = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Setting for K (Number of Similar Chunks)
        new Setting(containerEl)
            .setName('K (Number of Similar Chunks)')
            .setDesc('Number of similar chunks to retrieve for context')
            .addSlider((slider) =>
                slider
                    .setLimits(1, 20, 1)
                    .setValue(this.plugin.settings.K)
                    .onChange(async (value) => {
                        this.plugin.settings.K = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Setting for User Highlight Color
        new Setting(containerEl)
            .setName('User Highlight Color')
            .setDesc('Set the highlight color for "User" labels')
            .addText((text) =>
                text
                    .setPlaceholder('#FF5582A6')
                    .setValue(this.plugin.settings.userHighlightColor)
                    .onChange(async (value) => {
                        this.plugin.settings.userHighlightColor = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Setting for Assistant Highlight Color
        new Setting(containerEl)
            .setName('Assistant Highlight Color')
            .setDesc('Set the highlight color for "Assistant" labels')
            .addText((text) =>
                text
                    .setPlaceholder('#82FF55A6')
                    .setValue(this.plugin.settings.assistantHighlightColor)
                    .onChange(async (value) => {
                        this.plugin.settings.assistantHighlightColor = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}

// Main plugin class
export default class CanvasChatPlugin extends Plugin {
    settings: CanvasChatPluginSettings;

    async onload() {
        console.log('Loading Canvas Chat Plugin');

        // Load plugin settings
        await this.loadSettings();
        // Add the settings tab to the settings panel
        this.addSettingTab(new CanvasChatPluginSettingTab(this.app, this));

        // Add a ribbon icon to trigger the chat function
        this.addRibbonIcon('dice', 'Chat with LLM', async () => {
            await this.handleChat();
        });

        // Add a command to chat with LLM using the selected node
        this.addCommand({
            id: 'canvas-chat-plugin-chat-with-node',
            name: 'Chat with LLM using selected node',
            checkCallback: (checking: boolean) => {
                const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
                if (canvasView?.getViewType() === 'canvas') {
                    if (!checking) {
                        this.handleChat();
                    }
                    return true;
                }
                return false;
            },
        });
    }

    async onunload() {
        console.log('Unloading Canvas Chat Plugin');
    }

    // Load settings from disk
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    // Save settings to disk
    async saveSettings() {
        await this.saveData(this.settings);
    }

    /*######################################################
    # Functionalities
    ######################################################*/

    /*%%%%%%%%%%%%%%%%%%%%
    % Node Handling
    %%%%%%%%%%%%%%%%%%%%*/

    // Determine the type of a node (text, pdf, image)
    async getNodeType(node: any): Promise<string> {
        if (!node.filePath) {
            // If there is no filePath, it's a text node
            return 'text';
        } else {
            // Extract the file extension
            const fileExtension = node.filePath.split('.').pop();

            // Check if the file is a PDF
            if (fileExtension === 'pdf' || fileExtension === 'PDF') {
                return 'pdf';
            }
            // Check if the file is an image
            else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(fileExtension)) {
                return 'image';
            } else {
                // Default case if file type is unrecognized
                return 'text';
            }
        }
    }

    // Get the content of a node based on its type
    async getNodeContent(node: any): Promise<string | null> {
        if (await this.getNodeType(node) === 'text') {
            return node.text;
        } else if (await this.getNodeType(node) === 'pdf') {
            const filePath = node.file;
            const tfile = this.app.metadataCache.getFirstLinkpathDest(filePath, '');
            if (tfile instanceof TFile) {
                return await this.parsePdfToText(tfile);
            }
        } else if (await this.getNodeType(node) === 'image') {
            // Return empty string or handle image content separately
            return '';
        }

        return null;
    }

    // Check if a node has any connections (edges) in the canvas
    nodeHasConnections(node: any, canvas: any): boolean {
        return Array.from(canvas.edges.values()).some(
            (edge: any) => edge.from.node === node || edge.to.node === node
        );
    }

    // Recursively get all nodes connected to a given node
    getConnectedNodesRecursive(canvas: any, node: any, visitedNodes = new Set()): any[] {
        const connectedNodesSet = new Set<any>();
        visitedNodes.add(node);

        for (const edge of canvas.edges.values()) {
            let connectedNode = null;
            if (edge.from.node === node) {
                connectedNode = edge.to.node;
            } else if (edge.to.node === node) {
                connectedNode = edge.from.node;
            }

            if (connectedNode && !visitedNodes.has(connectedNode)) {
                connectedNodesSet.add(connectedNode);
                const furtherConnectedNodes = this.getConnectedNodesRecursive(
                    canvas,
                    connectedNode,
                    visitedNodes
                );
                furtherConnectedNodes.forEach((n) => connectedNodesSet.add(n));
            }
        }

        return Array.from(connectedNodesSet);
    }

    // Append the assistant's response as a new node connected to the original node
    async appendToNode(node: any, text: string) {
        try {
            const canvas = node.canvas;

            // Create a new text node positioned below the original node
            const newNode = canvas.createTextNode({
                pos: { x: node.x, y: node.y + node.height + 100 },
                text: `<mark style="background: ${this.settings.assistantHighlightColor};">Assistant:</mark> ${text}`,
                save: true,
                focus: false,
                size: { height: node.height, width: node.width },
            });

            // Create an edge connecting the original node to the new node
            const edge = {
                id: 'edge' + Date.now(),
                fromNode: node.id,
                fromSide: "bottom",
                toNode: newNode.id,
                toSide: "top"
            };

            // Add the new edge to the canvas data
            var data = canvas.getData();
            data.edges.push(edge);
            canvas.setData(data);
        } catch (error) {
            console.error('Cannot create a new node with the response.', error);
            new Notice('Cannot create a new node with the response.');
        }
    }

    /*%%%%%%%%%%%%%%%%%%%%
    % Image Handling
    %%%%%%%%%%%%%%%%%%%%*/

    // Convert an ArrayBuffer to a Base64 string (used for images)
    arrayBufferToBase64(buffer: ArrayBuffer): string {
        // Base64 encoding method compatible with Obsidian
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        // Use btoa to convert binary string to base64
        return btoa(binary);
    }

    // Get the Base64 data of an image node
    async getImageData(node: any): Promise<string | null> {
        if (node.type === 'image') {
            const filePath = node.file;
            const tfile = this.app.metadataCache.getFirstLinkpathDest(filePath, '');
            if (tfile instanceof TFile) {
                const arrayBuffer = await this.app.vault.readBinary(tfile);
                const base64Data = this.arrayBufferToBase64(arrayBuffer);
                return base64Data;
            }
        }
        return null;
    }

    // Check if connected nodes contain any image nodes
    connectedNodesContainImage(connectedNodes: any[]): boolean {
        return connectedNodes.some((node: any) => node.type === 'image');
    }

    /*%%%%%%%%%%%%%%%%%%%%
    % Chunking
    %%%%%%%%%%%%%%%%%%%%*/

    // Split content into smaller chunks for processing
    chunkContent(content: string): string[] {
        const maxChunkSize = 500; // Maximum size of each chunk
        const chunks = [];
        for (let i = 0; i < content.length; i += maxChunkSize) {
            chunks.push(content.substring(i, i + maxChunkSize));
        }
        return chunks;
    }

    // Retrieve the most similar chunks to the user's query using BM25 algorithm
    getMostSimilarChunksBM25(query: string, chunks: string[], K: number): string[] {
        // Use BM25 algorithm to get the most similar chunks
        const bm25 = new natural.TfIdf();

        // Add documents (chunks) to the BM25 index
        chunks.forEach((chunk, index) => {
            bm25.addDocument(chunk, index.toString());
        });

        // Get scores for each chunk
        const scores: { chunk: string; score: number }[] = [];
        bm25.tfidfs(query, (i: number, measure: number) => {
            scores.push({ chunk: chunks[i], score: measure });
        });

        // Sort chunks by score in descending order
        scores.sort((a, b) => b.score - a.score);

        // Return the top K chunks
        const topKChunks = scores.slice(0, K).map((item) => item.chunk);
        return topKChunks;
    }

    /*%%%%%%%%%%%%%%%%%%%%
    % PDF Handling
    %%%%%%%%%%%%%%%%%%%%*/

    // Parse a PDF file and extract its text content
    async parsePdfToText(file: TFile): Promise<string> {
        try {
            // Read the PDF file as an ArrayBuffer
            const arrayBuffer = await this.app.vault.readBinary(file);

            // Load the PDF using pdfjs-dist
            const pdfjsLib = require('pdfjs-dist/build/pdf');
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';

            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;

            let textContent = '';

            // Extract text from each page
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const text = await page.getTextContent();
                const pageText = text.items.map((item: any) => item.str).join(' ');
                textContent += pageText + '\n';
            }

            return textContent;
        } catch (error) {
            console.error('Error parsing PDF:', error);
            new Notice('Error parsing PDF.');
            return '';
        }
    }

    /*%%%%%%%%%%%%%%%%%%%%
    % Main Functions
    %%%%%%%%%%%%%%%%%%%%*/

    // Call the vLLM API with the provided messages and get the assistant's response
    async callVLLMAPI(messages: any[]): Promise<string> {
        const apiUrl = `${this.settings.vllmApiUrl}/v1/chat/completions`;

        const requestBody = {
            model: 'llama3.1:8b-instruct-fp16', // Specify the model to use
            messages: messages,
        };

        // Make a POST request to the vLLM API
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add 'Authorization' header if required by your vLLM server
            },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json();

        if (data.error) {
            console.error('Error calling vLLM API:', data.error);
            throw new Error(data.error.message);
        }

        // Return the assistant's response
        return data.choices[0].message.content;
    }

    // Handle the chat interaction when the user initiates a chat
    async handleChat() {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            new Notice('No active canvas view found.');
            return;
        }

        const canvas = (canvasView as any).canvas;
        const selectedNodes: any[] = Array.from(canvas.selection);

        if (selectedNodes.length === 0) {
            new Notice('No node selected.');
            return;
        }

        const selectedNode = selectedNodes[0];

        let userPrompt = await this.getNodeContent(selectedNode);
        if (userPrompt === null) {
            new Notice("Error reading user's input, make sure to select a textual node.");
            throw new Error("Error reading user's input, make sure to select a textual node.");
        }

        // Add "User:" prefix with highlight if not present
        const userMarkStart = `<mark style="background: ${this.settings.userHighlightColor};">User:</mark> `;
        if (!userPrompt.startsWith(userMarkStart)) {
            userPrompt = `${userMarkStart}${userPrompt}`;
            selectedNode.setData({ text: userPrompt });
        }

        let contextChunks: string[] = [];
        let conversationMessages: any[] = [];
        let connectedNodes: any[] = [];

        // Determine connected nodes
        if (this.nodeHasConnections(selectedNode, canvas)) {
            connectedNodes = this.getConnectedNodesRecursive(canvas, selectedNode);
        } else {
            connectedNodes = Array.from(canvas.nodes.values());
        }

        // Process connected nodes to build context and conversation history
        for (let node of connectedNodes) {
            let content = await this.getNodeContent(node);
            if (content !== null) {
                const userMark = `<mark style="background: ${this.settings.userHighlightColor};">User:</mark>`;
                const assistantMark = `<mark style="background: ${this.settings.assistantHighlightColor};">Assistant:</mark>`;
                if (content.startsWith(userMark)) {
                    // Remove markup and add to conversation as user message
                    const cleanContent = content.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '').replace('User:', '').trim();
                    conversationMessages.push({
                        role: 'user',
                        content: cleanContent,
                    });
                } else if (content.startsWith(assistantMark)) {
                    // Remove markup and add to conversation as assistant message
                    const cleanContent = content.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '').replace('Assistant:', '').trim();
                    conversationMessages.push({
                        role: 'assistant',
                        content: cleanContent,
                    });
                } else {
                    // Remove any markup and split into chunks for context
                    const cleanContent = content.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '');
                    const chunks = this.chunkContent(cleanContent);
                    contextChunks.push(...chunks);
                }
            }
        }

        // Retrieve the most similar chunks to the user's prompt
        const similarChunks = this.getMostSimilarChunksBM25(
            userPrompt.replace(/<mark[^>]*>.*?<\/mark>/g, '').trim(),
            contextChunks,
            this.settings.K
        );

        // Construct the prompt to send to the assistant
        let prompt = '';
        if (similarChunks.length > 0) {
            prompt += 'Here is some context that may be useful:\n';
            for (let i = 0; i < similarChunks.length; i++) {
                prompt += `Context ${i + 1}:\n${similarChunks[i]}\n\n`;
            }
        }

        // Clean the user prompt by removing labels and markup
        const cleanUserPrompt = userPrompt
            .replace(/<mark[^>]*>.*?<\/mark>/g, '')
            .replace('User:', '')
            .trim();

        prompt += `User Question:\n${cleanUserPrompt}\n`;

        console.log('Prompt generated:', prompt);

        // Construct the messages array to send to the assistant
        const messages = [
            {
                role: 'system',
                content: 'You are a helpful assistant.',
            },
            ...conversationMessages,
            {
                role: 'user',
                content: prompt,
            },
        ];

        try {
            // Call the vLLM API and get the assistant's response
            const response = await this.callVLLMAPI(messages);
            // Append the assistant's response to the canvas
            await this.appendToNode(selectedNode, response);
        } catch (error) {
            new Notice('Error: ' + error.message);
        }
    }
}
