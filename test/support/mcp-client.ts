import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function connectClient(url: string, token: string, responseBodies?: string[]): Promise<Client> {
  const client = new Client({ name: 'ambercast-mcp-test', version: '1.0.0' });
  const requestInit = { headers: { authorization: `Bearer ${token}` } };
  const transport = new StreamableHTTPClientTransport(new URL(url), responseBodies === undefined
    ? { requestInit }
    : {
      requestInit,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        responseBodies.push(await response.clone().text());
        return response;
      },
    });
  // SDK 1.30's transport declaration is not exact-optional compatible with
  // Client's Transport parameter even though the runtime transport is valid.
  await client.connect(transport as never);
  return client;
}

