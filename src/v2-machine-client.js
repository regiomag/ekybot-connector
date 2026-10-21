const ENDPOINT = 'https://jvqwmqlpozqoscmcigqn.supabase.co/functions/v1/ekybot-v2-machine';

function createMachineClient(config, fetchImpl = fetch) {
  if (config.endpoint !== ENDPOINT || !/^[a-f0-9]{64}$/.test(config.token || '')) {
    throw new Error('Invalid scoped machine configuration');
  }
  return async (body) => {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Machine request unconfirmed');
    }
    return response.json();
  };
}
module.exports = { ENDPOINT, createMachineClient };
