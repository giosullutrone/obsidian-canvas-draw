import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    ItemView,
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
		const nodeType = await this.getNodeType(node);
		if (nodeType === 'text') {
			return node.text;
		}
	
		return null;
	}

    // Check if a node has any inbound connections (edges) in the canvas
    nodeHasInboundConnections(node: any, canvas: any): boolean {
        return Array.from(canvas.edges.values()).some(
            (edge: any) => edge.to.node === node
        );
    }

    // Perform BFS to get inbound connected nodes
    getInboundConnectedNodesBFS(canvas: any, startNode: any, excludeNodes = new Set()): any[] {
        const visitedNodes = new Set();
        const queue = [];
        const nodesInOrder = [];

        queue.push(startNode);
        visitedNodes.add(startNode);

        while (queue.length > 0) {
            const currentNode = queue.shift();
            nodesInOrder.push(currentNode);

            for (const edge of canvas.edges.values()) {
                if (edge.to.node === currentNode) {
                    const connectedNode = edge.from.node;
                    if (!visitedNodes.has(connectedNode) && !excludeNodes.has(connectedNode)) {
                        visitedNodes.add(connectedNode);
                        queue.push(connectedNode);
                    }
                }
            }
        }

        return nodesInOrder;
    }

    // Get inbound edges of a node
    getInboundEdges(node: any, canvas: any): any[] {
        return Array.from(canvas.edges.values()).filter(
            (edge: any) => edge.to.node === node
        );
    }

    // Check if a node is an Assistant placeholder
    isAssistantPlaceholder(content: string): boolean {
        const cleanContent = content.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '').trim();
        return cleanContent === 'Assistant:';
    }

    // Check if a node is a User node
    isUserNode(content: string): boolean {
        const cleanContent = content.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '').trim();
        return cleanContent.startsWith('User:');
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
    % Main Functions
    %%%%%%%%%%%%%%%%%%%%*/

    // Check if any of the selected nodes are directly connected
    areNodesDirectlyConnected(selectedNodes: any[], canvas: any): boolean {
        // For each edge in the canvas, check if both nodes are in selectedNodes
        for (const edge of canvas.edges.values()) {
            const fromNode = edge.from.node;
            const toNode = edge.to.node;
            if (selectedNodes.includes(fromNode) && selectedNodes.includes(toNode)) {
                return true;
            }
        }
        return false;
    }

    // Validate that the conversation messages are in alternating order
    isConversationAlternating(messages: any[]): boolean {
        let lastRole = null;
        for (let message of messages) {
            if (message.role === 'system') {
                continue;
            }
            if (lastRole === null && message.role !== 'user') {
                return false;
            }
            if (lastRole !== null && message.role === lastRole) {
                return false;
            }
            lastRole = message.role;
        }
        return true;
    }

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

        // Check if any selected nodes are directly connected
        if (this.areNodesDirectlyConnected(selectedNodes, canvas)) {
            new Notice('Selected nodes are directly connected.');
            throw new Error('Selected nodes are directly connected.');
        }

        // Process each selected node individually
        for (const selectedNode of selectedNodes) {
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

            // Determine inbound connected nodes, excluding selected nodes
            connectedNodes = this.getInboundConnectedNodesBFS(
                canvas,
                selectedNode,
                new Set(selectedNodes)
            );

            // Remove the selected node from connectedNodes if it's included
            connectedNodes = connectedNodes.filter(node => node !== selectedNode);

            // Reverse the list to process nodes most distant first
            connectedNodes = connectedNodes.reverse();

            // Process connected nodes
            for (let node of connectedNodes) {
                let content = await this.getNodeContent(node);
                if (content !== null) {
                    const isAssistantPlaceholder = this.isAssistantPlaceholder(content);
                    if (isAssistantPlaceholder) {
                        // Get inbound edges from User nodes
                        const inboundEdges = this.getInboundEdges(node, canvas);
                        const userInboundNodes = [];
                        for (const edge of inboundEdges) {
                            const fromNode = edge.from.node;
                            const fromNodeContent = await this.getNodeContent(fromNode);
                            if (fromNodeContent && this.isUserNode(fromNodeContent)) {
                                userInboundNodes.push(fromNode);
                            }
                        }

                        if (userInboundNodes.length === 1) {
                            const userNode = userInboundNodes[0];
                            let userNodeContent = await this.getNodeContent(userNode);

                            if (userNodeContent === null) {
                                new Notice("Error reading user's input in user node.");
                                throw new Error("Error reading user's input in user node.");
                            }

                            // Add "User:" prefix with highlight if not present
                            if (!userNodeContent.startsWith(userMarkStart)) {
                                userNodeContent = `${userMarkStart}${userNodeContent}`;
                                userNode.setData({ text: userNodeContent });
                            }

                            // Prepare messages and context
                            let contextChunks: string[] = [];
                            let conversationMessages: any[] = [];

                            // For context, get connected nodes to userNode, excluding the assistant node and selected nodes
                            const contextNodes = this.getInboundConnectedNodesBFS(
                                canvas,
                                userNode,
                                new Set([...selectedNodes, node])
                            ).filter(n => n !== userNode);

                            // Reverse the contextNodes to process most distant first
                            contextNodes.reverse();

                            for (let contextNode of contextNodes) {
                                let contextContent = await this.getNodeContent(contextNode);
                                if (contextContent !== null) {
                                    const userMark = `<mark style="background: ${this.settings.userHighlightColor};">User:</mark>`;
                                    const assistantMark = `<mark style="background: ${this.settings.assistantHighlightColor};">Assistant:</mark>`;
                                    if (contextContent.startsWith(userMark)) {
                                        // Remove markup and add to conversation as user message
                                        const cleanContext = contextContent.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '').replace('User:', '').trim();
                                        conversationMessages.push({
                                            role: 'user',
                                            content: cleanContext,
                                        });
                                    } else if (contextContent.startsWith(assistantMark)) {
                                        // Remove markup and add to conversation as assistant message
                                        const cleanContext = contextContent.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '').replace('Assistant:', '').trim();
                                        conversationMessages.push({
                                            role: 'assistant',
                                            content: cleanContext,
                                        });
                                    } else {
                                        // Remove any markup and split into chunks for context
                                        const cleanContext = contextContent.replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '');
                                        const chunks = this.chunkContent(cleanContext);
                                        contextChunks.push(...chunks);
                                    }
                                }
                            }

                            // Validate conversationMessages order
                            if (!this.isConversationAlternating(conversationMessages)) {
                                new Notice('Conversation history is not in alternating order of user and assistant messages.');
                                throw new Error('Conversation history is not in alternating order of user and assistant messages.');
                            }

                            // Retrieve the most similar chunks to the user's prompt
                            const similarChunks = this.getMostSimilarChunksBM25(
                                userNodeContent.replace(/<mark[^>]*>.*?<\/mark>/g, '').trim(),
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

                            const cleanUserPrompt = userNodeContent
                                .replace(/<mark[^>]*>.*?<\/mark>/g, '')
                                .replace('User:', '')
                                .trim();

                            prompt += `User Question:\n${cleanUserPrompt}\n`;

                            console.log('Prompt generated for Assistant placeholder:', prompt);

                            // Construct messages
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

                            // Validate conversationMessages order
                            if (!this.isConversationAlternating(messages)) {
                                new Notice('Conversation history is not in alternating order of user and assistant messages.');
                                throw new Error('Conversation history is not in alternating order of user and assistant messages.');
                            }

                            try {
                                // Call the vLLM API and get the assistant's response
                                const response = await this.callVLLMAPI(messages);

                                // Add "Assistant:" prefix with highlight if not present
                                const assistantMarkStart = `<mark style="background: ${this.settings.assistantHighlightColor};">Assistant:</mark> `;
                                let assistantResponse = response;
                                if (!content.startsWith(assistantMarkStart)) {
                                    assistantResponse = `${assistantMarkStart}${response}`;
                                }

                                // Update the Assistant node
                                node.setData({ text: assistantResponse });

                            } catch (error) {
                                new Notice('Error: ' + error.message);
                            }

                        } else if (userInboundNodes.length > 1) {
                            new Notice('Assistant node has multiple incoming User nodes.');
                            throw new Error('Assistant node has multiple incoming User nodes.');
                        }

                    }
                }
            }

            // Now process the selected node as usual
            // Prepare context and conversation history
            contextChunks = [];
            conversationMessages = [];

            // For context, get inbound connected nodes excluding selected nodes
            let connectedNodesForSelected = this.getInboundConnectedNodesBFS(
                canvas,
                selectedNode,
                new Set(selectedNodes)
            ).filter(n => n !== selectedNode);

            // Reverse the list
            connectedNodesForSelected = connectedNodesForSelected.reverse();

            for (let node of connectedNodesForSelected) {
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

            // Validate conversationMessages order
            if (!this.isConversationAlternating(conversationMessages)) {
                new Notice('Conversation history is not in alternating order of user and assistant messages.');
                throw new Error('Conversation history is not in alternating order of user and assistant messages.');
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

            const cleanUserPrompt = userPrompt
                .replace(/<mark[^>]*>.*?<\/mark>/g, '')
                .replace('User:', '')
                .trim();

            prompt += `User Question:\n${cleanUserPrompt}\n`;

            console.log('Prompt generated for selected node:', prompt);

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

            // Validate conversationMessages order
            if (!this.isConversationAlternating(messages)) {
                new Notice('Conversation history is not in alternating order of user and assistant messages.');
                throw new Error('Conversation history is not in alternating order of user and assistant messages.');
            }

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
}
