# Rotina PMSC — app pessoal

App para acompanhar a rotina do plano: checklist do dia, estudo, questões, treino, calorias, água/café, peso e check-in para o coach.

- **Sem dependências**: só Node 18+ (não precisa de `npm install`).
- **Dados no servidor** (`DATA_DIR/state.json`) + cópia no celular: funciona offline e sincroniza quando a internet volta.
- **Protegido por PIN** (variável `APP_PIN`, obrigatória). Veja [Segurança](#segurança).

## Rodar no computador (opcional)

```bash
APP_PIN=246810 node server.js
# abra http://localhost:3000
```

## Publicar no Railway

1. Crie um repositório no GitHub e envie esta pasta (`server.js`, `package.json`, `public/`).
2. No Railway: **New Project → Deploy from GitHub repo** e escolha o repositório. Ele detecta o Node e roda `npm start` sozinho.
3. Na aba **Variables** do serviço, crie:
   - `APP_PIN` = um PIN só seu, com **pelo menos 6 dígitos** (de preferência 8). Sem ele, o app não abre.
   - `DATA_DIR` = `/data`
4. Adicione um **Volume** ao serviço com o caminho de montagem (mount path) `/data`.
   **Sem volume, os dados do servidor somem a cada novo deploy.** O celular reenvia a cópia dele, mas não conte com isso.
5. Em **Settings → Networking**, clique em **Generate Domain** para ter o link `https://...up.railway.app`.

Alternativa sem GitHub (Railway CLI):

```bash
npm i -g @railway/cli
railway login
railway init        # dentro desta pasta
railway up
```
Depois faça os passos 3 a 5 no painel.

## Instalar no iPhone

1. Abra o link do Railway no **Safari** (precisa ser o Safari).
2. Toque no ícone "Rotina" na tela de início, digite o PIN e deixe marcado **Lembrar neste aparelho**.
   O login feito no Safari não vale para o ícone (o iPhone separa os dois), então entre pelo ícone.
3. Toque em **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início** → **Adicionar**.
4. Abra sempre pelo ícone "Rotina": ele abre em tela cheia, como um app.

## Como usar

| Aba | Para quê |
| --- | --- |
| **Hoje** | Checklist hora a hora do plano. O tipo de dia (útil, terça, sábado, domingo, serviço) é escolhido sozinho e pode ser trocado. As refeições aparecem no horário, com kcal aproximadas. Registre questões/acertos, água e café. |
| **Peso** | Pese-se toda segunda em jejum. Gráfico, ritmo semanal e o ajuste de calorias que o coach recomenda. |
| **Semana** | Cumprimento por dia, horas de estudo, questões, treinos, leitura, média de kcal e dias com tempo de família. |
| **Check-in** | Preencha antes de dormir e toque em **Copiar check-in** para colar na conversa com o Claude. |
| **⚙︎ Ajustes** | Metas de kcal (aprox.)/água/café, data da próxima prova (troque para a PRF depois de 13/12), backup, sair deste aparelho ou de todos. |

O ponto no topo indica a sincronização: verde = salvo no servidor, laranja = enviando, vermelho = offline (salvo no celular).

## Segurança

- **PIN obrigatório.** Sem `APP_PIN`, a API fica bloqueada (falha fechada).
- **O PIN não fica salvo no celular.** O login troca o PIN por uma sessão em cookie `HttpOnly`, `Secure` e `SameSite=Strict`, que o JavaScript não consegue ler.
- **Lembrar neste aparelho:** a sessão dura 90 dias e é renovada com o uso. Desmarcado, ela some ao fechar o app (e expira em 12 h).
- **Bloqueio de tentativas:** 5 PINs errados bloqueiam aquele IP por 15 min, e o tempo dobra a cada novo bloqueio (até 24 h). 30 erros em 1 h, somando todos os IPs, bloqueiam o login de qualquer IP por 30 min. Aparelhos já logados continuam funcionando.
- **Sessões guardadas só como hash** em `DATA_DIR/sessions.json`. **Trocar o `APP_PIN` no Railway derruba todas as sessões.**
- **Sair:** em Ajustes, "Sair deste aparelho" apaga a cópia local dos dados. "Sair de todos os aparelhos" encerra todas as sessões.
- **Cabeçalhos:** CSP, HSTS, proibição de iframe, `no-referrer`, `noindex` e `robots.txt`, para o site não aparecer no Google.

**Perdeu o celular ou acha que viram seu PIN?** Troque o `APP_PIN` no Railway (as sessões caem na hora do redeploy) ou use "Sair de todos os aparelhos".

## Atualizar o app

Altere os arquivos, faça commit/push (ou `railway up`). Ao reabrir o app no iPhone, ele carrega a versão nova. Os dados ficam no volume e não são apagados.
