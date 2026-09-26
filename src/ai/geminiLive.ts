import { useDiagramStore } from '../diagram/store';
import { useConversationStore } from './conversationStore';
import { buildSystemPrompt } from './prompts';
import { DIAGRAM_TOOLS } from './tools';

type LiveState = 'idle' | 'connecting' | 'listening' | 'processing' | 'error';

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private onStateChange: (state: LiveState) => void;
  private onMessage: (msg: string) => void;

  constructor(apiKey: string, onStateChange: (state: LiveState) => void, onMessage: (msg: string) => void) {
    this.apiKey = apiKey;
    this.onStateChange = onStateChange;
    this.onMessage = onMessage;
  }

  connect() {
    this.onStateChange('connecting');
    const wsUrl =
      import.meta.env.VITE_GEMINI_LIVE_WS_URL ||
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
    const url = `${wsUrl}?key=${this.apiKey}`;
    
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.sendSetup();
      this.onStateChange('connecting');
      this.onMessage('Establishing Live session...');
    };

    this.ws.onmessage = (event) => {
      this.handleServerMessage(event);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      this.onStateChange('error');
      this.onMessage('Live connection failed.');
    };

    this.ws.onclose = (event) => {
      console.log('Gemini Live WebSocket closed:', event.code, event.reason);
      this.onStateChange('idle');
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendAudioChunk(base64Pcm: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=16000',
            data: base64Pcm
          }]
        }
      }));
    }
  }

  // Tells Gemini we finished speaking to prompt an immediate response
  sendEndTurn() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.onStateChange('processing');
      this.ws.send(JSON.stringify({
        clientContent: {
          turns: [],
          turnComplete: true
        }
      }));
    }
  }

  private sendSetup() {
    if (!this.ws) return;
    
    const store = useDiagramStore.getState();
    const simplifiedNodes = store.nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      type: n.data.type,
      subType: n.data.subType,
    }));
    const simplifiedEdges = store.edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    const systemPrompt = buildSystemPrompt({ nodes: simplifiedNodes, edges: simplifiedEdges });

    const setupMsg = {
      setup: {
        model: 'models/gemini-2.0-flash-exp',
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        tools: [{ functionDeclarations: DIAGRAM_TOOLS }]
      }
    };

    this.ws.send(JSON.stringify(setupMsg));
  }

  private handleServerMessage(event: MessageEvent) {
    try {
      if (event.data instanceof Blob) {
        event.data.text().then((text) => this.processServerContent(JSON.parse(text)));
      } else {
        this.processServerContent(JSON.parse(event.data));
      }
    } catch (err) {
      console.error('Failed to parse server message', err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processServerContent(data: any) {
    // 1. Setup handshake complete
    if (data.setupComplete) {
      console.log('Gemini Live session initialized successfully.');
      this.onStateChange('listening');
      this.onMessage('Gemini Live Ready. Listening...');
      return;
    }

    // 2. Direct root toolCall dispatch from Gemini Live!
    if (data.toolCall) {
      this.onStateChange('processing');
      this.handleToolCall(data.toolCall);
    }

    // 3. Server content streaming
    if (data.serverContent) {
      const { turnComplete, interrupted } = data.serverContent;
      
      if (interrupted) {
        console.log('Gemini Live speech interrupted.');
      }

      if (turnComplete) {
        this.onStateChange('listening');
      }
    }
  }

  private handleToolCall(toolCall: any) {
    const store = useDiagramStore.getState();
    const conversation = useConversationStore.getState();
    const calls = toolCall.functionCalls || [];
    const responses: any[] = [];
    const executedActions: string[] = [];

    calls.forEach((call: any) => {
      const { id, name, args } = call;
      let resultStr = '';
      try {
        switch (name) {
          case 'addNode':
            const newId = store.addNode(args);
            resultStr = `Added ${args.label} (${newId})`;
            break;
          case 'removeNode':
            store.removeNode(args.id);
            resultStr = `Removed ${args.id}`;
            break;
          case 'connect':
            store.connect(args.source, args.target, args.label);
            resultStr = `Connected ${args.source} -> ${args.target}`;
            break;
          case 'disconnect':
            store.disconnect(args.source, args.target);
            resultStr = `Disconnected ${args.source} and ${args.target}`;
            break;
          case 'insertBetween':
            store.insertBetween(args.source, args.target, args);
            resultStr = `Inserted ${args.label} between ${args.source} and ${args.target}`;
            break;
          case 'renameNode':
            store.renameNode(args.id, args.newLabel);
            resultStr = `Renamed ${args.id} to ${args.newLabel}`;
            break;
          case 'highlight':
            store.highlight(args.ids || []);
            resultStr = `Highlighted ${args.ids?.join(', ')}`;
            break;
          case 'reset':
            store.reset();
            resultStr = 'Canvas reset';
            break;
        }
        
        executedActions.push(resultStr);
        responses.push({
          id,
          name,
          response: { result: "Success" }
        });
      } catch (err: any) {
        console.error('Tool execution error:', err);
        responses.push({
          id,
          name,
          response: { error: err.message }
        });
      }
    });

    if (executedActions.length > 0) {
      this.onMessage(executedActions.join(' • '));
      conversation.addTurn({
        role: 'assistant',
        text: executedActions.join(', '),
        actions: executedActions,
        source: 'gemini'
      });
    }

    // Reply to the model with the tool response
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: responses
        }
      }));
    }
  }
}
