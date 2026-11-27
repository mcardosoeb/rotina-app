// Claude Code falso para os testes: imita "claude -p --output-format json".
// Grava o que recebeu em FAKE_CLAUDE_LOG e responde conforme FAKE_CLAUDE_MODE.
const fs = require('fs');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  if (process.env.FAKE_CLAUDE_LOG) {
    fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
      args,
      input,
      hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
      hasBaseUrl: 'ANTHROPIC_BASE_URL' in process.env,
      token: process.env.CLAUDE_CODE_OAUTH_TOKEN || null,
    }));
  }
  const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
  if (mode === 'login') {
    process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login' }));
    return;
  }
  const date = (input.match(/Hoje: (\d{4}-\d{2}-\d{2})/) || [])[1];
  process.stdout.write(JSON.stringify({
    type: 'result',
    is_error: false,
    result: '',
    structured_output: {
      reply: 'Coloquei a revisão às 20:30 hoje.',
      actions: [
        { tool: 'upsert_event', scope: 'dia', date, time: '20:30', title: 'Revisão rápida', category: 'estudo', duration_min: 20 },
        { tool: 'delete_event', scope: 'dia', date, id: 'nao-existe' },
      ],
    },
  }));
});
