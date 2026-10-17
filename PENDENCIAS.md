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
- **Babalorixá:** o modelo .glb enviado, otimizado de 48 MB para 2,5 MB, com esqueleto e as animações do jogo. Publicado como `client/public/models/realista-1.gltf` + `.bin` + texturas JPEG ao lado (`tools/rig/externalize.ts` faz essa conversão a partir do .glb do rig).
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
  - `node rig.ts <original.glb> /tmp/realista-1.glb && node externalize.ts /tmp/realista-1.glb ../../client/public/models/realista-1.gltf`
  - Visualizador: `npx vite --port 5310` e abra `http://localhost:5310/dev-rig.html?model=/models/realista-1.gltf&t=0.3&views=frente,costas`
- **Arquivos de apoio:** o original de 48 MB está na branch `modelos` (`modelos/result.glb`). As capturas dos avaliadores ficaram fora do repositório.
- **Alternativa de melhor qualidade:** fazer o rigging no Mixamo (mixamo.com, grátis). É preciso converter o .glb para .fbx ou .obj no Blender.
- **Direitos do modelo:** o usuário precisa confirmar que pode publicá-lo. Se foi gerado a partir da foto de uma pessoa real, precisa da autorização dela.

### 2. Servidor multiplayer real (prioridade alta antes do lançamento)
- A Vercel só roda a demonstração. O jogo de verdade precisa do servidor Node (`npm run build && npm start`) num host com WebSocket: Fly.io, Railway, Render ou uma VPS.
- Configurar `ALLOWED_ORIGINS` e, opcionalmente, Cloudflare na frente.
- **Teste de carga fora da meta:** com 1000 bots, o tick ficou em p95 165 ms (meta < 25 ms). O gargalo é `sendSnapshots` (`server/session.ts`): a seleção de interesse e um envio por cliente por tick. Os detalhes estão no commit `0ed012e`.

### 3. Mapa real do OpenStreetMap (precisa de você)
O ambiente de desenvolvimento não alcança o Overpass nem espelhos (Geofabrik, overpass.kumi.systems): os dados reais
têm que ser baixados numa máquina com internet. O `shared/map.json` atual ainda é o esquemático (`npm run map:esquematico`),
agora com praça pavimentada, estacionamentos, fileiras de árvores, os setores a oeste (quadras de prédios altos com
fachadas variadas), telões e carros estacionados, para a cidade já parecer cidade enquanto o OSM não chega.

O conversor (`tools/osm.ts`) já extrai do OSM: prédios com altura, cor (`building:colour`) e material da fachada
(`building:material`: vidro, concreto, tijolo), vias com largura, gramados, parques, matas (`natural=wood`, com árvores
plantadas dentro), praças e estacionamentos (piso pavimentado), água, fileiras de árvores e árvores isoladas, inclusive
em relações (multipolígonos). O cliente desenha tudo isso e o minimapa também.

**Como gerar (escolha um caminho):**
1. **Direto** (Node 22.18+ e internet): `npm run map`. Grava `shared/map.json`. Para guardar a resposta bruta:
   `npm run map -- --salvar tools/osm-bruto.json`.
2. **Pelo overpass-turbo.eu** (quando o Overpass bloqueia o script):
   - `npm run map -- --consulta` imprime a consulta. Cole em https://overpass-turbo.eu e rode.
   - Exportar → "dados brutos diretamente da API do Overpass" (raw data), salve o `.json`.
   - `npm run map -- --from caminho/do/arquivo.json`.
3. Depois: `npm run test`, `npm run dev:client` e confira as capturas (tela inicial e `C` para a câmera aérea).
   Se a origem cair dentro de um prédio, o script avisa; ajuste `ORIGIN` em `shared/geo.ts` ou o marco.
4. Faça o commit do `shared/map.json` (e do `tools/osm-bruto.json`, se quiser reprodutibilidade sem internet).

**O que mais ajuda na cidade realista:**
- **Área coberta:** hoje é da Rodoviária à Praça dos Três Poderes (`BBOX` em `tools/osm.ts`). Diga se quer incluir a
  Torre de TV, o Lago Paranoá ou os setores comerciais; o limite do protocolo é ±1638 m da origem.
- **Marcos para modelar à mão:** Congresso e Catedral já existem. Candidatos: Museu Nacional (cúpula), Biblioteca Nacional,
  Teatro Nacional, Palácio do Planalto, STF, Itamaraty (com os arcos e o espelho d'água), Rodoviária. Fotos de referência
  (frente, lateral, de cima) e medidas aproximadas (altura, largura) aceleram muito. Modelos `.glb` prontos também servem,
  desde que a licença permita uso no jogo.
- **Correções na fonte:** o que faltar no OSM (altura, `building:levels`, `building:colour`, árvores) pode ser editado
  direto em openstreetmap.org; a próxima rodada de `npm run map` já pega.
- **Capturas do resultado** em `C` (câmera aérea) e ao nível do chão, com o que parecer errado anotado.

### 3b. Interface do jogo (17/10): o que é só fachada por enquanto
A barra superior, os painéis laterais e a barra de ferramentas seguem a referência enviada (Paulista Livre). Funcionam:
Voltar, Entrar/apelido (voltam à tela inicial), som, tela cheia, ajuda, zoom +/−/recentrar, fechar o card do local,
chat com abas (Esplanada / Por perto) e altura, Veículos, Cartaz/bandeira (salva a escolha e volta à tela inicial),
Animações, Customização e Aéreo. Mostram um aviso "chega com a loja e as contas" ao clicar: **Premium, Passes,
Anunciar no jogo (telões), Superchat, Spray, PvP, Caminhada (inscrições) e Debates ao vivo.** Dependem dos
subprojetos do item 4. Os telões nas fachadas já existem (artes genéricas: "Anuncie aqui", "Sua marca aqui") e serão
o espaço vendido por "Anunciar no jogo".

Câmera: livre nos três eixos nos dois modos (arrastar gira, botão direito/Shift inclina, roda e +/− aproximam, Q/E
giram; espectador também desloca com setas/WASD e inclina com R/F; dois dedos giram e dão zoom no celular).

### 4. Subprojetos especificados e ainda não feitos
Ver `docs/specs/2026-10-16-contas-economia-p2w-design.md`.
- **Contas (Supabase):** login Google e e-mail/senha, cadastro do perfil (apelido, time, visual) e a migração `supabase/migrations/0002` (`look` integer). Hoje o login é de desenvolvimento (`client/src/auth.ts`).
- **Economia:** moedas via Pix (Woovi), loja de verdade, inventário, Premium e passes (referências enviadas pelo usuário). A loja atual mostra preços em moedas, mas o uso é grátis na pré-estreia.
- **PvP, território e influência.**

### 5. Ajustes menores
- **Babalorixá branco (17/10):** duas correções. (1) A CSP do `vercel.json` não permitia `blob:` em `connect-src`, e o GLTFLoader busca textura embutida por URL `blob:`; a falha é silenciosa (material sem mapa). (2) As texturas saíram de dentro do .glb: agora são JPEG em arquivos ao lado do `.gltf`, buscados como qualquer imagem do site, sem `blob:` e sem exigir a extensão WebP. O `models.ts` avisa no console se a textura não vier. Se ainda aparecer branco, abrir o console do navegador (F12) e mandar a mensagem.
- Tom de pele mais claro fica pálido no jogo e não bate com a prévia da tela inicial (tone mapping). Testar `THREE.NeutralToneMapping` ou AgX nos dois renderizadores.
- Personagens gerados em código: dedos fixos, cabelo longo pode atravessar os ombros, rosto só com cores (sem textura).
- O caminhão de som colide como um círculo (raio 2,4 m), mas tem ~10 m de comprimento: as pontas podem entrar em prédios.
- Música dos veículos: hoje é uma batucada sintetizada. A referência pedia escolher a música do lado.

## Decisões a respeitar
- **Lançamento público só depois do 2º turno (25/10/2026),** para não ser enquadrado como propaganda eleitoral. Por isso a Vercel está com proteção de acesso.
- **Sem caricaturas nem nomes de pessoas reais** (políticos, influenciadores) nos personagens e na loja, nem números de candidatos nos cartazes. O personagem "Lula Pai de Santo"/"Lula Babalorixá" foi recusado, porque associaria um candidato a uma religião de matriz africana em período eleitoral. Ele entrou como "Babalorixá".
- **Validação jurídica antes do lançamento:** ECA Digital, CDC art. 49 e nota fiscal (ver README).
