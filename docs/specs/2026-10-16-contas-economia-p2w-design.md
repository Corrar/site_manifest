# Contas, economia e mecânicas pay-to-win

Data: 2026-10-16 · Status: aguardando revisão
Complementa: [núcleo multiplayer](2026-10-16-nucleo-multiplayer-design.md)

## Visão geral e ordem dos subprojetos

| # | Subprojeto | Depende de | Nesta spec |
|---|---|---|---|
| 1 | Núcleo multiplayer | — | spec própria |
| 2 | Contas (Supabase Auth) | 1 | detalhado |
| 3 | Economia (moedas, Pix Woovi, loja, inventário) | 2 | detalhado |
| 4 | PvP | 3 | regras e catálogo; spec própria antes de implementar |
| 5 | Território | 3 | regras e catálogo; spec própria antes de implementar |
| 6 | Influência | 3 | regras e catálogo; spec própria antes de implementar |

**Regras de acesso:**
- **Jogar** (andar, falar, lutar, comprar) exige login.
- **Assistir** não exige: o espectador sem login vê a multidão e lê o chat.

## 2. Contas

### Login
- O login usa o Supabase Auth, com dois provedores: Google e e-mail/senha.
- Cadastro com e-mail/senha exige confirmar o e-mail antes de jogar. "Esqueci a senha" usa o fluxo do Supabase.
- Os modelos de e-mail ficam em português.
- Em produção, o envio passa por um SMTP próprio (ex.: Resend). O envio embutido do Supabase não aguenta o volume de um lançamento.
- O navegador usa `@supabase/supabase-js` **somente** para autenticação e para obter o access token.

### Primeiro acesso (onboarding)
Depois do primeiro login sem perfil, a tela de cadastro pede:
- **Apelido:** de 2 a 20 caracteres, espaços normalizados, filtro de palavras e único sem diferenciar maiúsculas/minúsculas nem acentos (coluna `nick_key`);
- **Time** (índice em `shared/teams.json`);
- **Visual** (índice);
- **Data de nascimento** (declarada).

Troca de time: no máximo 1 a cada 7 dias (`team_changed_at`).

### Fronteira de confiança
- Todas as escritas no banco passam pela nossa API HTTP, que roda no mesmo processo do servidor do jogo e usa a service role do Supabase.
- RLS fica ligado em todas as tabelas, sem política de escrita para `anon`/`authenticated`. O navegador não grava nada direto.
- A API e o `join` do WebSocket recebem o access token do Supabase. O servidor valida a assinatura pelas chaves públicas (JWKS do projeto), com a biblioteca `jose`, e confere `exp` e `aud`.
- Uma conexão WebSocket já aberta continua válida depois que o token expira. Toda reconexão envia um token novo.
- Conta banida (`banned_until` no futuro) é recusada no `join` e na API.

### LGPD
- `DELETE /api/conta` apaga o perfil e o usuário de autenticação.
- Pedidos e extrato permanecem por 5 anos para fins fiscais, com `user_id` anulado (`on delete set null`).

## 3. Economia

### Pacotes de moedas (`shared/shop.json`, valores iniciais)

| id | Preço | Moedas |
|---|---|---|
| `p5` | R$ 5,00 | 500 |
| `p10` | R$ 10,00 | 1.100 |
| `p25` | R$ 25,00 | 3.000 |
| `p50` | R$ 50,00 | 6.500 |

### Fluxo de compra Pix (Woovi)
1. `POST /api/moedas/pedido {package_id}` (requer login e idade declarada ≥ 18). O servidor:
   - cria `orders` com `status=pending`;
   - cria a cobrança na Woovi com `correlationID = order.id`, `value` em centavos e expiração de 15 min;
   - devolve `{order_id, brCode, qrCodeImage, expiresAt}`.
2. A Woovi chama `POST /api/webhooks/woovi` (evento de cobrança concluída). O servidor:
   - verifica a assinatura do webhook;
   - **consulta a cobrança na API da Woovi** pelo `correlationID` e só segue se ela estiver paga e o valor bater com o pedido.
3. O crédito é feito pela função SQL `credit_order(order_id)`, numa única transação:
   - `pending → paid`;
   - insere no extrato `(+coins, reason='pix', ref=order_id)`;
   - atualiza `wallets.balance`.

   Repetir a chamada não tem efeito, porque o extrato tem unicidade em `(reason, ref)` e o status só sai de `pending` uma vez.
4. Se o jogador estiver online, o servidor envia `{t:"wallet", balance}` pelo WebSocket. A tela também consulta `GET /api/moedas/pedido/:id` a cada 3 s enquanto o QR estiver aberto.
5. Pix devolvido (MED/estorno) gera, via webhook, uma entrada `(−coins, reason='estorno', ref=order_id)` e `status=refunded`. Isso pode deixar o saldo negativo, e com saldo negativo o jogador não consegue gastar.

Antes de implementar a integração, conferir na documentação oficial da Woovi: os nomes exatos dos campos da cobrança, os eventos de webhook e o método de assinatura.

### Gasto
- `POST /api/loja/comprar {item_id}`. O servidor busca o preço em `shop.json` e ignora qualquer preço enviado pelo cliente.
- A função SQL `spend(user_id, item_id, price, grant)`, numa transação, confere `balance ≥ price`, debita (`reason='compra_item'`), entrega o item em `inventory` e devolve o novo saldo e o inventário.
- O servidor do jogo aplica o efeito na hora no estado em memória do jogador.
- **Tipos de item:**
  - `permanente` (`quantity` nulo);
  - `consumivel` (`quantity`, decrementado no uso pelo servidor do jogo);
  - `temporario` (`expires_at`).
- Itens básicos são gratuitos e não passam pela loja. Itens especiais só existem por compra.

### Tabelas (Supabase Postgres)

```
profiles      id uuid pk → auth.users (on delete cascade), nick, nick_key unique,
              team smallint, look smallint, birth_date date, role text default 'player',
              banned_until timestamptz, team_changed_at timestamptz, created_at
wallets       user_id uuid pk, balance integer not null default 0
orders        id uuid pk, user_id uuid null (on delete set null), package_id, amount_cents,
              coins, status (pending|paid|expired|refunded), woovi_charge_id, created_at, paid_at
wallet_ledger id bigserial pk, user_id uuid null (on delete set null), delta integer,
              reason (pix|compra_item|estorno|ajuste_staff), ref text, created_at,
              unique (reason, ref)   -- ref de compra_item é um uuid gerado por compra
inventory     user_id uuid, item_id text, quantity integer null, expires_at timestamptz null,
              primary key (user_id, item_id)
```

### API HTTP (todas com `Authorization: Bearer <access token>`, exceto o webhook)

| Método e rota | Função |
|---|---|
| `GET /api/me` | perfil, saldo e inventário |
| `POST /api/perfil` | onboarding e atualização (apelido, time, visual, nascimento) |
| `GET /api/loja` | catálogo (pacotes e itens) |
| `POST /api/moedas/pedido` | cria um pedido Pix |
| `GET /api/moedas/pedido/:id` | status do pedido (só o dono) |
| `POST /api/loja/comprar` | gasta moedas num item |
| `POST /api/webhooks/woovi` | confirmação e estorno de pagamento |
| `DELETE /api/conta` | exclusão de conta |

As rotas da API têm limite de taxa por conta e por IP.

### Regras legais (validar com advogado/contador antes do lançamento)
- Não há caixas de recompensa aleatórias (vedadas para menores pelo ECA Digital, Lei 15.211/2025). Todo item é vendido diretamente, com preço visível.
- Compras só com idade declarada ≥ 18.
- Moedas não usadas são reembolsáveis em até 7 dias após a compra (art. 49 do CDC).
- A emissão de nota fiscal fica fora do sistema por enquanto.

### Configuração (variáveis de ambiente, nunca versionadas)
- Servidor: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WOOVI_APP_ID`, `WOOVI_WEBHOOK_SECRET`, `ALLOWED_ORIGINS`, `PORT`.
- Cliente (públicas): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- `.env` fica no `.gitignore`.

## 4–6. Mecânicas pay-to-win

Cada sistema terá uma spec própria antes de ser implementado. Os valores abaixo são iniciais e ficam em `shared/balance.json`, ajustáveis sem mexer em código.

### Tetos (protegem quem não paga)
- Fôlego e dano: no máximo +50% sobre o básico.
- Multiplicadores de pontos não se acumulam (vale o maior ativo).
- Todo efeito é calculado pelo servidor do jogo. O cliente só exibe.

### 4. PvP
- **Fôlego:** 100 no básico.
- **Queda:** quem chega a 0 cai e volta em 5 s na base do time.
- **Bases:** são zonas sem combate. Quem volta fica 3 s invulnerável.
- **Pontuação:** cada derrubada dá pontos no ranking PvP (diário, semanal, geral).
- **Grátis:** golpe de cartaz, dano 10, alcance 1,5 m, recarga 0,8 s.

| Item | Tipo | Efeito inicial | Moedas |
|---|---|---|---|
| Guarda-chuva | permanente | dano 14, alcance 2 m | 800 |
| Bandeirão | permanente | dano 12, alcance 3 m | 1.200 |
| Megafone sônico | permanente | dano 8 em cone de 4 m, empurra todos atingidos, recarga 3 s | 1.500 |
| Ovo (5 un.) | consumível | arremesso de 12 m, dano 15 | 100 |
| Bexiga d'água (5 un.) | consumível | arremesso de 10 m, dano 8 em área de 2 m | 150 |
| Colete | permanente | +50 de fôlego | 1.000 |
| Garrafa d'água (3 un.) | consumível | recupera 40 de fôlego | 120 |
| Recuperação rápida | temporário 1 h | volta em 2 s | 200 |

### 5. Território
- A Esplanada tem ~12 zonas, entre elas Congresso, Praça dos Três Poderes, Catedral e os gramados dos ministérios.
- A cada 2 s, a presença de cada time numa zona é a soma do peso dos seus jogadores dentro dela (peso 1 por jogador, mais os itens).
- O time com mais presença avança a captura da zona. Uma zona sai de neutra para capturada em 60 s de vantagem contínua.
- **Rodadas:** a cada 2 h, o time com mais zonas vence a rodada, e isso alimenta o placar dos times.

| Item | Tipo | Efeito inicial | Moedas |
|---|---|---|---|
| Bandeira fincada | consumível | +3 de presença na zona por 10 min (pode ser derrubada no PvP) | 150 |
| Mastro alto | permanente | sua presença vale 1,5 | 1.500 |

### 6. Influência
- **Pontos por:**
  - minuto ativo na avenida (máx. 120 por dia);
  - mensagem de chat (máx. 1 ponto/min);
  - aplauso recebido (cada jogador tem 20 aplausos/dia para dar, e não pode aplaudir a si mesmo);
  - participação em captura;
  - derrubada.
- **Ranking:** diário, semanal e geral, por jogador e por time.

| Item | Tipo | Efeito inicial | Moedas |
|---|---|---|---|
| Multiplicador ×2 | temporário 1 h | dobra os pontos de influência | 250 |
| Megafone de chat (5 un.) | consumível | mensagem destacada no topo do chat por 10 s | 100 |
| Apelido em destaque | permanente | apelido dourado sobre a cabeça e no chat | 600 |

## Testes

- **Contas:**
  - validação e unicidade do apelido (incluindo acentos e maiúsculas);
  - troca de time respeita os 7 dias;
  - `join` de jogador sem token, com token inválido/expirado ou com conta banida é recusado;
  - espectador sem token é aceito.

  Os tokens de teste são assinados por uma chave local servida como JWKS de teste.
- **Economia** (contra um Postgres local de teste com as mesmas migrações):
  - `credit_order` é idempotente (dois webhooks, um crédito);
  - webhook com assinatura inválida, ou com cobrança não paga na consulta à Woovi (mock), não credita;
  - `spend` com saldo insuficiente falha sem debitar;
  - compras concorrentes não deixam o saldo negativo;
  - estorno debita;
  - o preço vem do servidor.
- **Mecânicas:** cada spec própria define seus testes. Os tetos de vantagem são testados por unidade.

## Critérios de pronto (subprojetos 2 e 3)

1. Cadastro com Google e com e-mail/senha (com confirmação de e-mail) funcionando, além de "esqueci a senha".
2. Onboarding grava o perfil e o jogador entra no jogo com seu apelido e time. Sem login, só é possível assistir.
3. Compra de pacote via Pix no ambiente de testes da Woovi credita as moedas uma única vez, e o saldo aparece no jogo sem recarregar.
4. Gastar moedas entrega o item, e o servidor do jogo aplica o efeito.
5. Todos os testes de contas e economia passam.
