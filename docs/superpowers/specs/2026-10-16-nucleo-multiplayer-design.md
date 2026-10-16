# Núcleo multiplayer — manifestação online na Esplanada

Data: 2026-10-16 · Status: aguardando revisão

## Objetivo

Jogo 3D multiplayer no navegador, para lançamento público: uma manifestação online na Esplanada dos Ministérios (Brasília), com times políticos reais. Inspirado no formato do Paulista Livre (manifestacao.com), mas com código e assets próprios — nada do concorrente é reaproveitado.

Este documento cobre só o **núcleo**: entrar com apelido e time (ou só assistir), andar na Esplanada vendo os outros, e o chat da avenida. Todo o resto vira subprojeto próprio (ver "Fora do escopo").

**Calendário:** o 2º turno é em 2026-10-25. O lançamento público acontece depois dessa data, para não ser enquadrado como propaganda eleitoral.

## Decisões

| Tema | Decisão |
|---|---|
| Arquitetura | Própria: servidor autoritativo + protocolo binário com área de interesse |
| Linguagem | TypeScript em todo o projeto; npm workspaces |
| Servidor | Node 24 executando TypeScript direto (type stripping, sem build): só sintaxe apagável, sem `enum`/`namespace`; imports com extensão `.ts` |
| Rede | Biblioteca `ws`, um único processo, um WebSocket em `/ws` |
| Cliente | Vite + Three.js; interface em HTML/CSS puro, sem framework |
| Testes | Vitest |
| Persistência | Nenhuma no núcleo (sem contas, sem banco); chat em memória + log em arquivo |
| Hospedagem | Decidida depois; o processo serve `client/dist` e `/ws` na porta `PORT` |
| Times | Dados em `shared/teams.json` (nome, cor, símbolo), trocáveis sem mexer em código |

## Estrutura

```
Manifest/
├─ shared/
│   ├─ protocol.ts     tipos das mensagens JSON + codificação/decodificação binária
│   ├─ constants.ts    todas as constantes da tabela abaixo
│   └─ teams.json
├─ server/
│   ├─ index.ts        HTTP (arquivos estáticos) + upgrade do WebSocket em /ws
│   ├─ world.ts        estado dos jogadores, aplicação de inputs, movimento, colisão
│   ├─ interest.ts     grade espacial; consultas "perto" e "longe"
│   ├─ session.ts      join/welcome, token de retomada, ping, timeouts, limites
│   └─ chat.ts         filtro, limite de envio, histórico, log
├─ client/
│   ├─ net.ts          WebSocket, reconexão, decodificação dos snapshots
│   ├─ scene/          mapa, avatares (perto), multidão em sprites (longe), câmera
│   ├─ ui/             lobby, chat, HUD
│   └─ input.ts        WASD/Shift e joystick de toque
└─ tools/
    └─ osm-esplanada.ts   gera shared/map.json a partir do OpenStreetMap (roda uma vez)
```

Cada arquivo tem uma responsabilidade. `shared/protocol.ts` é o contrato entre cliente e servidor e é testado isoladamente.

## Constantes

| Nome | Valor | Uso |
|---|---|---|
| `TICK_HZ` | 20 | simulação e snapshots "perto" |
| `WALK_SPEED` / `RUN_SPEED` | 1,6 / 4,0 m/s | movimento |
| `CELL_SIZE` | 16 m | grade espacial |
| `NEAR_RADIUS` / `NEAR_MAX` | 40 m / 64 | snapshot "perto" |
| `FAR_RADIUS` / `FAR_MAX` / `FAR_HZ` | 300 m / 1000 / 2 | snapshot "longe" |
| `POS_SCALE` | 20 | posição em int16 = metros × 20 (5 cm; alcance ±1638 m) |
| `MAX_PLAYERS` | 1500 | lotação por processo; acima disso, entra como espectador |
| `LOBBY_STATS_MS` | 2000 | intervalo dos `stats` do lobby |
| `PING_MS` / `TIMEOUT_MS` | 5000 / 20000 | ping do cliente / desconexão por silêncio |
| `RESUME_MS` | 30000 | janela para retomar o personagem com o token |
| `MAX_FRAME_BYTES` | 4096 | tamanho máximo de mensagem do cliente |
| `MAX_MSGS_PER_SEC` | 30 | por conexão; quem excede é desconectado |
| `MAX_CONN_PER_IP` | 10 | conexões simultâneas por IP |
| `CHAT_MIN_INTERVAL_MS` / `CHAT_MAX_LEN` | 1500 / 200 | chat |
| `CHAT_HISTORY` | 40 | mensagens enviadas no `welcome` |
| `NICK_MIN` / `NICK_MAX` | 2 / 20 | apelido |
| `INTERP_DELAY_MS` | 100 | atraso de interpolação no cliente |

Origem das coordenadas: centro do Eixo Monumental entre a Catedral e o Congresso. X aponta para o leste (em direção ao Congresso) e Z para o sul, em metros.

## Protocolo

### Mensagens JSON (texto)

Do cliente para o servidor:

| `t` | Campos | Quando |
|---|---|---|
| `lobby` | — | ao abrir a página, antes de entrar |
| `join` | `nick`, `team` (índice), `spectate` (bool), `token` (string ou null) | entrar ou retomar |
| `input` | `dx`, `dz` ∈ [-1,1] (direção no mundo), `run` (bool), `seq` (0–65535, circular) | quando a intenção muda, e a cada 1 s como "ainda aqui"; no máximo 20/s |
| `view` | `x`, `z` | espectador: posição da câmera, no máximo 5/s |
| `chat` | `text` | enviar mensagem |
| `ping` | `at` | a cada `PING_MS` |

Do servidor para o cliente:

| `t` | Campos |
|---|---|
| `stats` | `online`, `teams` (contagem por time) — para quem está no lobby |
| `welcome` | `id`, `token`, `serverTime`, `spectator` (bool), `history` (últimas mensagens de chat), `full` (bool: entrou como espectador por lotação) |
| `names` | `people`: `[{id, nick, team, look}]` — enviado uma vez quando o jogador entra no raio de alguém |
| `chat` | `id`, `nick`, `team`, `text`, `at` |
| `error` | `code` (`nick_invalid`, `team_invalid`, `rate_limited`, …), `message` |
| `pong` | `at`, `now` |
| `restarting` | — (o servidor vai reiniciar; o cliente reconecta) |

### Snapshots binários (servidor → cliente, little-endian)

**PERTO** (`type = 0x01`), a cada tick:

```
u8  type = 0x01
u32 tick
u16 ackSeq      último seq de input aplicado para este jogador
u8  count       ≤ NEAR_MAX (inclui o próprio jogador, se não for espectador)
count × 10 bytes:
  u16 id
  i16 x × POS_SCALE
  i16 z × POS_SCALE
  u8  yaw         0–255 → 0–2π
  u8  anim        0 parado, 1 andando, 2 correndo, 3 acenando
  u8  team
  u8  look        variação de visual (índice)
```

**LONGE** (`type = 0x02`), a `FAR_HZ`. São os jogadores até `FAR_RADIUS` que não entraram no PERTO (inclusive os que estão dentro de `NEAR_RADIUS` mas além dos `NEAR_MAX` mais próximos), até `FAR_MAX`, os mais próximos primeiro:

```
u8  type = 0x02
u32 tick
u16 count
count × 7 bytes:
  u16 id
  i16 x × POS_SCALE
  i16 z × POS_SCALE
  u8  team
```

Os ids são u16, alocados por processo. Um id só é reaproveitado 60 s depois que o jogador sai.

Estimativa de pior caso, numa multidão densa: perto 64×10 B×20/s ≈ 13 KB/s, mais longe 1000×7 B×2/s ≈ 14 KB/s, total ~27 KB/s por jogador. A compressão delta fica para depois, e só se a medição do teste de carga mostrar necessidade.

## Servidor

- **Laço de tick (50 ms):** aplica o último input de cada jogador, move com a velocidade da constante, resolve a colisão com os contornos dos prédios (o jogador desliza ao longo da parede), atualiza a grade espacial e monta e envia os snapshots. Um erro ao processar um jogador é registrado e não interrompe o tick dos outros.
- **Colisão:** usa os mesmos polígonos de `map.json` que o cliente desenha. Os limites do mapa formam uma parede.
- **Espectador:** não tem corpo. Sua área de interesse é a última `view`, que começa no centro do mapa.
- **Retomada:** o `token` (aleatório, 128 bits) identifica o jogador por `RESUME_MS` depois da queda. Ao retomar, ele volta com o mesmo id, posição, time e apelido.
- **Apelido:** o texto é normalizado (espaços nas pontas removidos e espaços internos colapsados), precisa ter entre `NICK_MIN` e `NICK_MAX` caracteres e passa pelo filtro de palavras. Se já estiver em uso, o servidor acrescenta um número.
- **Lotação:** com `MAX_PLAYERS` atingido, o `join` vira espectador e o `welcome` sai com `full: true`.
- **Reinício:** ao receber SIGTERM, o servidor envia `restarting`, fecha as conexões e encerra.

## Segurança (fronteira de confiança: tudo o que vem do cliente)

- Toda mensagem é validada (tipo `t` conhecido, campos com tipo e faixa corretos, tamanho até `MAX_FRAME_BYTES`). Mensagem inválida é descartada, e 10 inválidas seguidas derrubam a conexão.
- Há limite de taxa por conexão (`MAX_MSGS_PER_SEC`) e de conexões por IP (`MAX_CONN_PER_IP`).
- IP real: o cabeçalho `CF-Connecting-IP` só é usado quando o IP de origem pertence às faixas do Cloudflare. Fora disso, vale o IP do socket.
- O upgrade do WebSocket só é aceito se o `Origin` estiver na lista configurada (`ALLOWED_ORIGINS`).
- O cliente nunca envia posição, só intenção. A velocidade é imposta pelo servidor.
- Chat: filtro de palavras, `CHAT_MIN_INTERVAL_MS` e `CHAT_MAX_LEN`. O texto é exibido como texto, nunca como HTML.
- Log do chat: arquivo diário com horário, id, apelido, time e texto, sem IP. Arquivos com mais de 7 dias são apagados.

## Cliente

- **Lobby:** mostra os `stats` (online por time), a escolha de time, o campo de apelido e os botões "Entrar" e "Só quero assistir".
- **Interpolação:** os outros jogadores são desenhados `INTERP_DELAY_MS` no passado, interpolando entre os dois snapshots que cercam esse instante. No snapshot "longe", a posição é interpolada entre as amostras de 2 Hz.
- **Predição:** o próprio jogador se move na hora, com a mesma função de movimento do servidor, compartilhada via `shared/`. A cada snapshot, o cliente reaplica os inputs ainda não confirmados (`seq` > `ackSeq`) a partir da posição do servidor. Diferenças pequenas são suavizadas em ~100 ms; acima de 2 m, a posição salta direto.
- **Mapa:** `map.json` é carregado e os prédios são extrudados em poucas malhas mescladas (uma por material). O Congresso Nacional (duas torres, cúpula e tigela) e a Catedral são modelados em código com primitivas.
- **Personagens:** um modelo `.glb` de licença CC0, com animações parado/andando/correndo/acenando. Critérios de escolha: licença CC0, arquivo ≤ 2 MB e ≤ 5 mil triângulos (candidatos: Quaternius, Kenney). A camisa usa a cor do time.
  - **Perto:** até 64 instâncias animadas, com o apelido sobre a cabeça.
  - **Longe:** sprites em `InstancedMesh`, gerados ao carregar o jogo a partir do próprio modelo: 8 ângulos × cada time, em um atlas de textura.
- **Câmera:** o jogador usa terceira pessoa atrás do personagem; o espectador, câmera livre de cima, com arrastar e zoom.
- **Controles:** WASD + Shift no computador; joystick virtual no celular.
- **Desempenho:** no celular, o `devicePixelRatio` fica limitado a 1,5 e as sombras ficam desligadas.
- **Falhas:** uma faixa "Reconectando…" aparece durante a reconexão (com espera crescente: 1, 2, 4, 8 s, até 15 s). Se o contexto WebGL for perdido, uma mensagem com botão de recarregar.
- **Atribuição:** "© colaboradores do OpenStreetMap" sempre visível.

## Mapa (tools/osm-esplanada.ts)

- Consulta a Overpass API para a caixa que vai da Rodoviária do Plano Piloto à Praça dos Três Poderes (~2,5 × 1 km).
- Gera `shared/map.json` com:
  - ruas: polilinha + largura (pela tag `lanes`/`width`; padrão de 3,5 m por faixa);
  - prédios: contorno + altura (pela tag `height`, ou `building:levels` × 3,2 m; padrão 12 m);
  - gramados e água: polígonos.
- As coordenadas são convertidas para metros locais a partir da origem definida acima.
- O arquivo gerado vai versionado; o jogo não consulta o OpenStreetMap em tempo de execução.

## Testes

- **Unitários (Vitest):**
  - codificação/decodificação de PERTO e LONGE (ida e volta, limites de faixa);
  - movimento e colisão (não atravessa parede, desliza ao longo dela);
  - grade de interesse (perto/longe corretos, `NEAR_MAX`, ordem por distância);
  - chat (filtro, intervalo, tamanho);
  - validação e unicidade de apelido;
  - validação de mensagens malformadas.
- **Integração:** sobe o servidor real numa porta livre e conecta 2 clientes `ws`. Verifica que:
  - os dois entram e um vê o outro no snapshot PERTO após mover;
  - o chat chega aos dois;
  - a reconexão com token devolve o mesmo id e a mesma posição;
  - a lotação transforma o `join` em espectador.
- **Carga (`tools/bots.ts`):** N clientes `ws` andando aleatoriamente (padrão 1000). Mede o tempo de tick (p50/p95/máx) e os bytes por cliente por segundo.

## Critérios de pronto

1. É possível abrir o site, ver o lobby com os números por time, escolher time e apelido, entrar na Esplanada, andar vendo os outros com apelido e usar o chat.
2. O modo espectador funciona: câmera de cima, sem avatar, recebendo a área da câmera.
3. Com 1000 bots num processo, o tick fica em p95 < 25 ms, e o tráfego médio por cliente fica dentro da estimativa acima.
4. Reconectar em até 30 s devolve o mesmo personagem.
5. O jogo roda a ~30 fps num celular intermediário (verificação manual).
6. Todos os testes unitários e de integração passam.

## Fora do escopo (próximos subprojetos)

- Contas e login
- Pagamentos via Pix e loja
- Caricaturas e skins
- Veículos
- PvP
- Pichação
- Voz no palanque
- Telões e anúncios
- Corridas e missões
- Painel de moderação e denúncias
- Hospedagem e deploy
- Vários processos ou servidores
