# Manifest: manifestação online na Esplanada

Jogo 3D multiplayer no navegador. É uma manifestação online na Esplanada dos Ministérios, em Brasília, com times políticos, chat, PvP, disputa de território e ranking de influência. Para jogar é preciso entrar com Google ou com e-mail e senha. Para assistir, não. Itens especiais são comprados com moedas, pagas via Pix.

> **Status:** em especificação. Ainda não há código: os documentos de design estão em [`docs/specs`](docs/specs). O nome "Manifest" é provisório.

## Documentação

| Documento | Conteúdo |
|---|---|
| [Núcleo multiplayer](docs/specs/2026-10-16-nucleo-multiplayer-design.md) | Arquitetura, protocolo de rede (JSON + snapshots binários), servidor autoritativo a 20 Hz, área de interesse, mapa do OpenStreetMap, testes |
| [Contas, economia e pay-to-win](docs/specs/2026-10-16-contas-economia-p2w-design.md) | Login (Supabase), moedas via Pix (Woovi), loja e inventário, PvP, território, influência, regras legais |

## Roadmap

| # | Subprojeto | Status |
|---|---|---|
| 1 | Núcleo multiplayer: mapa, andar com outros jogadores, chat, espectador | Especificado |
| 2 | Contas: Google, e-mail/senha, perfil | Especificado |
| 3 | Economia: moedas, Pix, loja, inventário | Especificado |
| 4 | PvP | Regras e catálogo definidos |
| 5 | Território | Regras e catálogo definidos |
| 6 | Influência | Regras e catálogo definidos |

## Stack planejada

- **Cliente:** Vite + Three.js, com interface em HTML/CSS puro
- **Servidor:** Node 24 (TypeScript direto, sem build) + `ws`, num único processo que serve o jogo, a API e o WebSocket
- **Contas e banco:** Supabase (Auth + Postgres)
- **Pagamentos:** Pix via Woovi
- **Testes:** Vitest

## Estrutura planejada

```
shared/   protocolo, constantes, times, loja e balanceamento (usado por cliente e servidor)
server/   servidor do jogo e API HTTP
client/   jogo no navegador
tools/    gerador do mapa (OpenStreetMap) e bots de teste de carga
docs/     especificações e planos
```

## Serviços necessários

- Projeto no **Supabase**
- Credenciais OAuth no **Google Cloud Console**
- Conta na **Woovi** para receber Pix
- Serviço de e-mail (ex.: **Resend**) com domínio próprio

As chaves ficam em variáveis de ambiente (`.env`) e nunca entram no repositório. A lista de variáveis está na spec de contas e economia.

## Avisos

- **Período eleitoral:** o lançamento público fica para depois do 2º turno (25/10/2026), para o jogo não ser enquadrado como propaganda eleitoral.
- **Validação jurídica antes do lançamento:**
  - ECA Digital (Lei 15.211/2025): o jogo não tem caixas de recompensa aleatórias;
  - direito de arrependimento (art. 49 do CDC);
  - emissão de nota fiscal.
- **Mapa:** © colaboradores do OpenStreetMap (ODbL).
