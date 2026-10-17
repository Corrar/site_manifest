# Pendências: onde paramos

Atualizado em 17/10/2026. Branch de trabalho: `claude/funny-albattani-vgt5cn`.
Demonstração publicada na Vercel: https://manifest-delta-five.vercel.app (projeto `manifest`, protegido pelo login da Vercel).

## O que está pronto

- **Núcleo multiplayer:** as 15 tarefas do plano (`docs/plans/2026-10-16-nucleo-multiplayer.md`). Servidor Node com WebSocket, protocolo binário, predição e interpolação, chat, espectador.
- **Modo demonstração na Vercel** (`npm run build:demo`). O servidor roda dentro do navegador, com 300 pessoas simuladas.
- **Tela inicial** no padrão das referências: escolha do time, prévia 3D com animações e criador de visual. Loja de personagens com tipos originais.
- **Jogo estilo RP:** emotes (1 acenar, 2 dançar), carro e caminhão de som com batucada, câmera aérea, minimapa e barra de ações.
- **Mapa com céu físico, sombras e texturas:** ministérios de vidro, faixas, árvores com ipês, Congresso, Catedral e Mastro da Bandeira.
- **Personagens semi-realistas** gerados em código (`client/src/scene/character.ts`).
- **Babalorixá:** o modelo .glb enviado, otimizado de 48 MB para 2,2 MB, com esqueleto e as animações do jogo (`client/public/models/realista-1.glb`).
- **Revisão completa** com 24 achados confirmados. Os altos e médios foram corrigidos (commit `77c7864`).

## Pendências

### 1. Babalorixá: rigging (prioridade alta)
- **Corrida e chute:** quando o joelho dobra muito, a canela da perna de trás aparece pela saia.
- **Qual versão foi publicada:** a da 1ª rodada de ajustes. Andar, acenar, dançar e o repouso estão bons.
- **Atenção: o `tools/rig/rig.ts` ficou no meio da 2ª rodada.** Rodando agora, ele gera uma versão PIOR: a canela atravessa a frente da saia ao correr e dançar. Por isso o asset publicado não foi regenerado. Antes de regerar, termine o `shinTubes()`:
  - tubo da canela arredondado e texturizado;
  - continuar o tubo até o joelho em vez de terminar numa tampa plana;
  - transição de pesos lowerLeg→upperLeg em volta do joelho.
- **Como continuar:**
  - `cd tools/rig && npm install`
  - `node rig.ts <original.glb> ../../client/public/models/realista-1.glb`
  - Visualizador: `npx vite --port 5310` e abra `http://localhost:5310/dev-rig.html?model=/models/realista-1.glb&t=0.3&views=frente,costas`
- **Arquivos de apoio:** o original de 48 MB está na branch `modelos` (`modelos/result.glb`). As capturas dos avaliadores ficaram fora do repositório.
- **Alternativa de melhor qualidade:** fazer o rigging no Mixamo (mixamo.com, grátis). É preciso converter o .glb para .fbx ou .obj no Blender.
- **Direitos do modelo:** o usuário precisa confirmar que pode publicá-lo. Se foi gerado a partir da foto de uma pessoa real, precisa da autorização dela.

### 2. Servidor multiplayer real (prioridade alta antes do lançamento)
- A Vercel só roda a demonstração. O jogo de verdade precisa do servidor Node (`npm run build && npm start`) num host com WebSocket: Fly.io, Railway, Render ou uma VPS.
- Configurar `ALLOWED_ORIGINS` e, opcionalmente, Cloudflare na frente.
- **Teste de carga fora da meta:** com 1000 bots, o tick ficou em p95 165 ms (meta < 25 ms). O gargalo é `sendSnapshots` (`server/session.ts`): a seleção de interesse e um envio por cliente por tick. Os detalhes estão no commit `0ed012e`.

### 3. Mapa real do OpenStreetMap
- O `shared/map.json` atual é esquemático (`npm run map:esquematico`), porque o Overpass estava bloqueado no ambiente de desenvolvimento.
- Numa máquina com internet, rode `npm run map` e confira as capturas.

### 4. Subprojetos especificados e ainda não feitos
Ver `docs/specs/2026-10-16-contas-economia-p2w-design.md`.
- **Contas (Supabase):** login Google e e-mail/senha, cadastro do perfil (apelido, time, visual) e a migração `supabase/migrations/0002` (`look` integer). Hoje o login é de desenvolvimento (`client/src/auth.ts`).
- **Economia:** moedas via Pix (Woovi), loja de verdade, inventário, Premium e passes (referências enviadas pelo usuário). A loja atual mostra preços em moedas, mas o uso é grátis na pré-estreia.
- **PvP, território e influência.**

### 5. Ajustes menores
- Tom de pele mais claro fica pálido no jogo e não bate com a prévia da tela inicial (tone mapping). Testar `THREE.NeutralToneMapping` ou AgX nos dois renderizadores.
- Personagens gerados em código: dedos fixos, cabelo longo pode atravessar os ombros, rosto só com cores (sem textura).
- O caminhão de som colide como um círculo (raio 2,4 m), mas tem ~10 m de comprimento: as pontas podem entrar em prédios.
- Música dos veículos: hoje é uma batucada sintetizada. A referência pedia escolher a música do lado.

## Decisões a respeitar
- **Lançamento público só depois do 2º turno (25/10/2026),** para não ser enquadrado como propaganda eleitoral. Por isso a Vercel está com proteção de acesso.
- **Sem caricaturas nem nomes de pessoas reais** (políticos, influenciadores) nos personagens e na loja, nem números de candidatos nos cartazes. O personagem "Lula Pai de Santo"/"Lula Babalorixá" foi recusado, porque associaria um candidato a uma religião de matriz africana em período eleitoral. Ele entrou como "Babalorixá".
- **Validação jurídica antes do lançamento:** ECA Digital, CDC art. 49 e nota fiscal (ver README).
