import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFile,
	ItemView,
  } from 'obsidian';
  import * as natural from 'natural';
  
  interface CanvasChatPluginSettings {
	vllmApiUrl: string; // e.g., http://localhost:8000
	K: number;
  }
  
  const DEFAULT_SETTINGS: CanvasChatPluginSettings = {
	vllmApiUrl: 'http://localhost:8000',
	K: 5,
  };
  
  export default class CanvasChatPlugin extends Plugin {
	settings: CanvasChatPluginSettings;
  
	async onload() {
	  console.log('Loading Canvas Chat Plugin');
  
	  await this.loadSettings();
	  this.addSettingTab(new CanvasChatPluginSettingTab(this.app, this));
  
	  this.addRibbonIcon('chat-gpt', 'Chat with LLM', async () => {
		await this.handleChat();
	  });
  
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
  
	async loadSettings() {
	  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
  
	async saveSettings() {
	  await this.saveData(this.settings);
	}
  
	async handleChat() {
	  const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
  
	  if (!canvasView || canvasView.getViewType() !== 'canvas') {
		new Notice('No active canvas view found.');
		return;
	  }
  
	  const canvas = (canvasView as any).canvas;
	  const selectedNodes = Array.from(canvas.selection);
  
	  if (selectedNodes.length === 0) {
		new Notice('No node selected.');
		return;
	  }
  
	  const selectedNode = selectedNodes[0];
  
	  const userPrompt = await this.getNodeContent(selectedNode);
  
	  let contextChunks: string[] = [];
	  let connectedNodes: any[] = [];
  
	  if (this.nodeHasConnections(selectedNode, canvas)) {
		connectedNodes = this.getConnectedNodes(canvas, selectedNode);
	  } else {
		connectedNodes = Array.from(canvas.nodes.values());
	  }
  
	  for (let node of connectedNodes) {
		const content = await this.getNodeContent(node);
		const chunks = this.chunkContent(content);
		contextChunks.push(...chunks);
	  }
  
	  // Get the most similar chunks using BM25
	  const similarChunks = this.getMostSimilarChunksBM25(
		userPrompt,
		contextChunks,
		this.settings.K
	  );
  
		// Create a well-written prompt that includes the chunks and the user prompt
		let prompt = '';
		if (similarChunks.length > 0) {
		prompt += 'Here is some context that may be useful:\n';
		for (let i = 0; i < similarChunks.length; i++) {
			prompt += `Context ${i + 1}:\n${similarChunks[i]}\n\n`;
		}
		}

		prompt += `User Question:\n${userPrompt}\n`;

		console.log('Prompt generated:', prompt);

		// Construct the messages array
		const messages = [
		{
			role: 'system',
			content: 'You are a helpful assistant.',
		},
		{
			role: 'user',
			content: prompt,
		},
		];
	  /*let prompt = 'You are a helpful assistant.\n\n';
	  if (similarChunks.length > 0) {
		prompt += 'Here is some context that may be useful:\n';
		for (let i = 0; i < similarChunks.length; i++) {
		  prompt += `Context ${i + 1}:\n${similarChunks[i]}\n\n`;
		}
	  }
  
	  prompt += `User Question:\n${userPrompt}\n`;
  
	  // Handle images in connected nodes
	  let containsImage = this.connectedNodesContainImage(connectedNodes);
	  let imageContents: any[] = [];
  
	  if (containsImage) {
		for (let node of connectedNodes) {
		  if (node.type === 'image') {
			const imageData = await this.getImageData(node);
			if (imageData) {
			  imageContents.push({
				type: 'image_base64',
				image_base64: { data: imageData },
			  });
			}
		  }
		}
	  }*/
  
	  // Construct the message content
	  // let messageContent: any[] = [{ type: 'text', text: prompt }];
	  // let messageContent: any = { text: prompt };
  
	  // Include images in the message content
	  /*if (imageContents.length > 0) {
		messageContent = messageContent.concat(imageContents);
	  }*/
  
	  try {
		const response = await this.callVLLMAPI(messages);
		await this.appendToNode(selectedNode, response);
	  } catch (error) {
		new Notice('Error: ' + error.message);
	  }
	}
  
	async getNodeType(node: any): Promise<string> {
		if (!node.filePath) {
		  // If there is no filePath, it's a text node
		  return 'text';
		} else {
		  // Extract the file extension
		  const fileExtension = node.filePath.split('.').pop().toLowerCase();
	  
		  // Check if the file is a PDF
		  if (fileExtension === 'pdf') {
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
  
	nodeHasConnections(node: any, canvas: any): boolean {
	  return Array.from(canvas.edges.values()).some(
		(edge: any) => edge.from.node === node || edge.to.node === node
	  );
	}
  
	getConnectedNodes(canvas: any, node: any): any[] {
	  const connectedNodesSet = new Set<any>();
  
	  for (const edge of canvas.edges.values()) {
		if (edge.from.node === node) {
		  connectedNodesSet.add(edge.to.node);
		} else if (edge.to.node === node) {
		  connectedNodesSet.add(edge.from.node);
		}
	  }
  
	  return Array.from(connectedNodesSet);
	}
  
	chunkContent(content: string): string[] {
	  const maxChunkSize = 500;
	  const chunks = [];
	  for (let i = 0; i < content.length; i += maxChunkSize) {
		chunks.push(content.substring(i, i + maxChunkSize));
	  }
	  return chunks;
	}
  
	getMostSimilarChunksBM25(
	  query: string,
	  chunks: string[],
	  K: number
	): string[] {
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
  
	connectedNodesContainImage(connectedNodes: any[]): boolean {
	  return connectedNodes.some((node: any) => node.type === 'image');
	}
  
	async callVLLMAPI(messages: any[]): Promise<string> {
	  const apiUrl = `${this.settings.vllmApiUrl}/v1/chat/completions`;
  
	  const requestBody = {
		model: 'llama3.1:8b-instruct-fp16',
		messages: messages,
	  };
  
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
  
	  return data.choices[0].message.content;
	}
  
	async appendToNode(node: any, text: string) {
		try {
			node.text += '\nAssistant: ' + text;
		} catch (error) {
			console.error('Cannot write response to this node type.', error);
			new Notice('Cannot write response to this node type.');
		}
	}
  
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
  }
  
  class CanvasChatPluginSettingTab extends PluginSettingTab {
	plugin: CanvasChatPlugin;
  
	constructor(app: App, plugin: CanvasChatPlugin) {
	  super(app, plugin);
	  this.plugin = plugin;
	}
  
	display(): void {
	  const { containerEl } = this;
  
	  containerEl.empty();
  
	  containerEl.createEl('h2', { text: 'Canvas Chat Plugin Settings' });
  
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
	}
  }
  