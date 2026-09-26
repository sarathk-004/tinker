// Gemini Function Calling Declarations for tinker Architecture Operations

export const DIAGRAM_TOOLS = [
  {
    name: 'addNode',
    description: 'Add a new component or service to the architecture diagram. Node types include client, gateway, service (EC2/Lambda), database (RDS/Postgres), cache (Redis), queue (SQS), storage (S3), or generic.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: {
          type: 'STRING',
          description: 'Unique concise identifier for the node (e.g., "client", "api_gateway", "auth", "orders", "postgres", "redis"). If omitted, generated from label.',
        },
        label: {
          type: 'STRING',
          description: 'Display name of the component (e.g. "API Gateway", "Orders Service", "PostgreSQL", "Redis Cache").',
        },
        type: {
          type: 'STRING',
          enum: ['client', 'gateway', 'service', 'database', 'cache', 'queue', 'storage', 'generic'],
          description: 'Category of the architectural component.',
        },
        subType: {
          type: 'STRING',
          description: 'Specific AWS or technology descriptor (e.g., "Amazon RDS", "ElastiCache / Redis", "Application Load Balancer", "Amazon EC2", "AWS Lambda", "Amazon S3").',
        },
      },
      required: ['label'],
    },
  },
  {
    name: 'removeNode',
    description: 'Remove a component from the diagram. Also automatically removes any connections to or from this component.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: {
          type: 'STRING',
          description: 'Identifier or name of the node to remove (e.g., "auth", "redis").',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'connect',
    description: 'Draw a directed connection or data flow arrow from a source component to a target component.',
    parameters: {
      type: 'OBJECT',
      properties: {
        source: {
          type: 'STRING',
          description: 'The source node identifier (origin of the arrow).',
        },
        target: {
          type: 'STRING',
          description: 'The target node identifier (destination of the arrow).',
        },
        label: {
          type: 'STRING',
          description: 'Optional label on the connection (e.g., "HTTPS", "gRPC", "reads/writes", "async").',
        },
        bidirectional: {
          type: 'BOOLEAN',
          description: 'Set to true if data flows both ways or connection is bidirectional (adds reverse arrow).',
        },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'disconnect',
    description: 'Remove a connection or edge between two components.',
    parameters: {
      type: 'OBJECT',
      properties: {
        source: {
          type: 'STRING',
          description: 'Source node identifier.',
        },
        target: {
          type: 'STRING',
          description: 'Target node identifier.',
        },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'insertBetween',
    description: 'Restructure the diagram by inserting a new component directly between two existing connected components. Automatically breaks the old direct connection and inserts the new component in between (source -> new -> target). Example: "Put Redis between Orders and PostgreSQL".',
    parameters: {
      type: 'OBJECT',
      properties: {
        source: {
          type: 'STRING',
          description: 'The existing upstream component (e.g. "orders").',
        },
        target: {
          type: 'STRING',
          description: 'The existing downstream component (e.g. "postgres").',
        },
        id: {
          type: 'STRING',
          description: 'Concise identifier for the new node (e.g., "redis").',
        },
        label: {
          type: 'STRING',
          description: 'Display name of the new component (e.g. "Redis Cache").',
        },
        type: {
          type: 'STRING',
          enum: ['client', 'gateway', 'service', 'database', 'cache', 'queue', 'storage', 'generic'],
          description: 'Category of the new component.',
        },
        subType: {
          type: 'STRING',
          description: 'Specific AWS or technology descriptor (e.g. "ElastiCache / Redis").',
        },
      },
      required: ['source', 'target', 'label'],
    },
  },
  {
    name: 'renameNode',
    description: 'Rename an existing component without affecting its connections.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: {
          type: 'STRING',
          description: 'Identifier of the node to rename.',
        },
        newLabel: {
          type: 'STRING',
          description: 'New display name.',
        },
      },
      required: ['id', 'newLabel'],
    },
  },
  {
    name: 'highlight',
    description: 'Highlight one or more components and their connected pathways to focus attention, dimming other unrelated components.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ids: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'List of node identifiers to highlight (e.g. ["orders", "postgres", "redis"]).',
        },
      },
      required: ['ids'],
    },
  },
  {
    name: 'reset',
    description: 'Clear the entire diagram and start over with a fresh canvas.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'explainOrAnswer',
    description: 'Provide an architectural explanation, blast radius analysis (e.g. "What happens if Auth goes down?"), data flow walk-through, or simplify the system for a non-technical person.',
    parameters: {
      type: 'OBJECT',
      properties: {
        explanation: {
          type: 'STRING',
          description: 'Clear, concise, professional spoken architectural answer or explanation.',
        },
        highlightNodeIds: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional list of node ids involved in the explanation to highlight on the diagram.',
        },
      },
      required: ['explanation'],
    },
  },
];
