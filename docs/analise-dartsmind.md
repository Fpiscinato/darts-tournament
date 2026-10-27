# Dartsmind vs. Darts Tournament Manager — análise de viabilidade

> Documento de decisão. Recolha feita em 2026-10-27 a partir de
> <https://www.dartsmind.com/> e da ficha App Store (`id1018594473`).
> Estimativas de esforço são ordens de grandeza para **um** developer a
> tempo parcial, não compromissos.

## 1. O que é o Dartsmind

App nativo iOS/iPadOS (Zaglab Ltd.), 4.8★ / 600 avaliações, 115 MB,
iOS 15+, com compras in-app. O produto vende-se por **uma** coisa:

**Auto-scoring só com a câmara traseira do dispositivo.** Sem sensores,
sem hardware extra, "funciona a qualquer altura e ângulo", "modelo de IA
treinado para dardos, a correr 100% no dispositivo" (offline e privado),
compatível com a maioria dos tabuleiros de ponta de aço, e opcionalmente
**duas câmaras em dois dispositivos** para maior precisão.

Requisito de hardware: **chip A12 ou superior** — sinal claro de que a
detecção corre um modelo de rede neuronal no dispositivo.

Restante catálogo (o "jogo" à volta do auto-scoring):

| Bloco | Conteúdo |
| --- | --- |
| X01 | 210 a 1501 |
| Cricket | Standard, No Score, Tactic, Random, Cut-Throat |
| Prática | Around the Clock, JDC Challenge, 41-60, Catch 40, 9 Darts Double Out (121/81), 99 Darts at XX, Round the World, Bob's 27, Random Checkout, 170, Cricket Count Up, Count Up |
| Party | Hammer Cricket, Half It, Killer, Shanghai, Bermuda, Gotcha |
| Sistema | Lobby online global, DartBot (vários níveis, X01 + Cricket), legs **e** sets, até 6 jogadores, estatísticas detalhadas por jogo, settings por jogo |

## 2. Onde estamos hoje

O nosso app é um **gestor de torneios** offline-first; o Dartsmind é um
**jogo** com auto-scoring. O overlap é menor do que parece.

| Área | Dartsmind | Darts Tournament Manager | Gap |
| --- | --- | --- | --- |
| Registo de pontos | Por seta, automático por câmara | **Só por leg** (botão "Wins Leg") | 🔴 |
| Motor X01 (501, duplo-out, bust, checkout) | Sim | Não existe | 🔴 |
| Cricket / práticas / party games | 24 modos | Nenhum | 🔴 |
| Torneios (liga, eliminatória, byes, W.O., ranking all-time) | Secundário | **Completo e bem testado** | ✅ vantagem nossa |
| Jogadores por partida | Até 6 | 1 vs 1 | 🟡 |
| Formato | Legs **e** sets | Best of 3/5/7 (legs) | 🟡 |
| Estatísticas | Detalhadas por jogo (médias, checkout %, etc.) | Só classificação/legs | 🔴 |
| Oponente virtual | DartBot multi-nível | Não | 🟡 |
| Online | Lobby global | Nenhum (proibido pelo `SECURITY.md`) | ⛔ |
| Auto-scoring | Câmara + IA on-device | Nenhum | 🔴 (o grande tema) |
| Partilha de resultados | ? | Imagem de classificação | ✅ |
| Backup / offline / PWA | Offline, mas app nativa | Backup JSON, PWA, offline total | ✅ |

Resumo: temos a camada de **competição**; falta-nos a camada de **jogo**.

## 3. Viabilidade por bloco, no nosso stack

Veredicto: ✅ encaixa bem · 🟡 encaixa com trabalho extra · 🔴 risco alto · ⛔ não encaixa no modelo atual

| # | Bloco | Veredicto | Porquê |
| --- | --- | --- | --- |
| A | Motor X01 (501/301/701, duplo-out, bust, legs/sets) | ✅ | Funções puras em TS, exatamente o padrão de `src/lib/*` + testes |
| B | Tabela de checkouts + sugestão de finalização | ✅ | Tabela estática + pesquisa simples; 100% offline |
| C | Cricket (5 variantes) + Cut-Throat | 🟡 | Regras simples mas muitas variantes; ~400–600 LOC + testes |
| D | Jogos de prática (13) | 🟡 | Cada um é um "mode" com regras próprias; baratos individualmente, caros em conjunto |
| E | Party games (6) | 🟡 | Idem, alguns exigem ordem de turnos e eliminação (Killer) |
| F | DartBot | ✅ | Simulador estatístico (média + distribuição), sem rede |
| G | Até 6 jogadores + estatísticas por seta | 🟡 | Implica migração do modelo de dados (Dexie v2): nova tabela de `visits`/`throws` |
| H | Lobby online global | ⛔ | Exige servidor, contas e sincronização. Contraria `SECURITY.md` e `AGENTS.md` ("o app deve continuar 100% local"). Alternativas sem backend: pass-and-play, importar/exportar torneio, QR com estado |
| I | Auto-scoring por câmara | 🔴 | Tecnicamente possível no browser, mas é um produto de visão computacional dentro de outro produto (ver §4) |

### O que isto significa na prática

- **A + B + F** dão o "core loop" do Dartsmind (jogar 501 contra o DartBot
  com sugestões de checkout) com esforço moderado e risco baixo.
- **C + D + E** é volume, não dificuldade: é onde está a maior parte das
  ~5.000–8.000 linhas de regras do Dartsmind. Dá para fazer por fases.
- **H** é uma decisão de arquitetura, não uma feature. Recomendo não fazer.

## 4. Auto-scoring por câmara no browser — o que é preciso

É a única parte verdadeiramente difícil. Ponto de partida honesto: existe
muita investigação aberta (Autodarts, dart-sense, OpenDartboard,
opencv-steel-darts) e **quase todas** usam 2–3 câmaras + OpenCV em
desktop/Raspberry Pi. Uma câmara de telemóvel, em ângulo livre, com
processamento no browser, é o caso mais difícil de todos — e é
precisamente o que o Dartsmind resolve com um modelo treinado.

### 4.1 Pipeline necessário

1. **Captura** — `getUserMedia` (obriga a HTTPS, que já temos via
   Cloudflare) + `requestVideoFrameCallback`. 720p–1080p a 10–15 fps de
   processamento chega; 60 fps só aquece o telemóvel.
   *Limitação iOS:* o Safari só mantém **uma** câmara ativa — o modo
   dual-device do Dartsmind não é replicável no browser. Ecrã ligado via
   Wake Lock API (iOS 16.4+).

2. **Calibração do tabuleiro** — 4 pontos tocados no ecrã (interseções do
   duplo em 20/6/3/11) → homografia 4×4 para o plano do tabuleiro em mm.
   Guardar por "setup" em IndexedDB. A deteção automática do tabuleiro
   (Hough / segmentação) é possível mas instável com oclusão por dardos —
   na v1, calibração manual é a escolha certa.

3. **Geometria de pontuação** — régua oficial (mm, raio a partir do
   centro): bull interno 6,35 · bull externo 15,9 · triplo 99–107 · duplo
   162–170 · exterior 170. `score = f(raio, ângulo)`. Esta parte é
   matemática exata: **se o ponto da ponta estiver bem detetado, a
   pontuação está certa.** Todo o risco está no passo 4.

   Já validado fora do app: 60/60 pontos de referência (20 números ×
   simples/triplo/duplo) devolvem a pontuação correta, e a homografia de
   4 pontos fecha o ciclo pixel→mm→pixel com erro ~1e-13 px. Ou seja, os
   passos 2 e 3 são código determinístico e testável — não são o risco.

4. **Deteção do dardo** — o problema real. Três abordagens:
   - **CV clássico**: diferença entre frames + deteção do *corpo* do dardo
     (barrel/flight, que é grande e de alto contraste) e projeção do eixo
     até ao plano do tabuleiro para estimar a ponta. Não precisa de
     treino, é o que os projetos OSS usam. Precisão típica relatada:
     ~70–90%, muito sensível a luz e oclusão.
   - **ML**: detetor tipo YOLO-nano (2–5 MB quantizado int8) treinado em
     milhares de frames reais. `onnxruntime-web` com WASM SIMD/threads no
     iOS (WebGPU ainda não está no ORT-web para Safari, apesar de o Safari
     26 já expor WebGPU) e WebGPU no Android/desktop. 20–80 ms/frame.
   - **Híbrido** (recomendado a prazo): clássico propõe candidatos, o
     modelo valida a ponta.

5. **Estado do turno** — 3 dardos por visita, ignorar mão/braço a entrar no
   frame, detetar remoção dos dardos e "tabuleiro limpo" para nova ronda,
   lidar com dardo que cai/rebate.

6. **Confirmação humana** — mostrar o dardo marcado no tabuleiro e deixar
   corrigir com um toque. Sem isto, qualquer erro de deteção arruína a
   experiência; com isto, mesmo 90% de acerto é utilizável.

### 4.2 Restrições concretas do browser

- **Precisão geométrica**: com 1080p e o tabuleiro (340 mm de diâmetro
  útil) a ocupar ~60% do frame, são ~0,52 mm/pixel; a 720p, ~0,78 mm/px.
  O aro do triplo tem 8 mm (≈15 px a 1080p) — há margem folgada. O problema
  não é a resolução: é a ponta do dardo ser detetada com ≥2–3 px de erro
  e o dardo entrar em ângulo.
- **iOS/Safari**: sem WebGPU no ORT-web → modelos pequenos e quantizados;
  threads WASM limitadas; suspensão de PWA ao bloquear o ecrã.
- **Bateria/calor**: processar a 10–15 fps e parar quando não há jogo.
- **Dataset**: para chegar a >97% (o que o Dartsmind faz), é preciso
  recolher e etiquetar frames em vários tabuleiros, luzes, ângulos e
  telemóveis. Isto é trabalho de semanas/meses, não de dias.

### 4.3 Esforço realista

| Etapa | Esforço | Resultado |
| --- | --- | --- |
| Spike: calibração + homografia + CV clássico, 1 tabuleiro, 1 dispositivo | 2–3 semanas | Saber se é viável **em casa dele** (go/no-go) |
| MVP: 3 dardos/visita, correção manual, X01 integrado | +4–6 semanas | Utilizável em boas condições |
| Produto: ML + dataset + multi-dispositivo + tuning | +3–6 meses | Perto do Dartsmind |

## 5. Recomendação

1. **Não copiar o Dartsmind.** Copiar o *catálogo* dele é meses de regras
   de jogo; copiar o *auto-scoring* é um projeto de visão computacional.
2. **Fazer o motor de jogo primeiro.** É onde o nosso app tem uma base
   melhor do que o Dartsmind (modelo de dados limpo, funções puras,
   testes, offline real) e onde o valor por hora é maior.
3. **Ordem sugerida**:
   - Fase 1 — `x01.ts` (501/301, duplo-out, bust), `checkout.ts`, ecrã
     **Play** separado de **Tournament**, gravação de visitas → estatísticas
     (média de 3 dardos, checkout %, dardos na dupla, best leg).
   - Fase 2 — Cricket + primeiros jogos de prática (Around the Clock,
     Bob's 27, Count Up, 170).
   - Fase 3 — DartBot + até 6 jogadores + legs/sets + migração Dexie v2.
   - Fase 4 — **só depois**, spike de câmara: 2–3 semanas para provar (ou
     matar) a ideia antes de investir meses.
4. **Lobby online: não.** Rompe o contrato de segurança e privacidade do
   projeto. Se houver procura, o caminho compatível é partilha de ficheiro
   de torneio e QR com o estado do jogo.

## 6. Riscos a assumir

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Auto-scoring nunca chegar a qualidade aceitável | Alto (meses perdidos) | Spike de 2–3 semanas com critério de sucesso definido antes |
| Modelo de dados atual (só legs) | Médio | Dexie v2 + migração testada com backup import/export |
| Escopo: virar "mais um app de dardos" e perder o foco em torneios | Médio | Manter Play e Tournament como áreas separadas |
| Volume de regras (24 modos) | Médio | Fases, um modo de cada vez, cada um com testes |
| iOS/Safari limita câmara | Médio | Assumir 1 câmara; testar em iPhone real cedo |

## 7. Próximos passos concretos

Se decidires avançar pela Fase 1, o trabalho começa em:

1. `src/lib/x01.ts` — estado de visita (`startScore`, `darts[]`,
   `checkoutMode`), `applyVisit()`, `bust`, `isFinished` (funções puras).
2. `src/lib/x01.test.ts` — casos: 180, bust por passar de 0, duplo-out,
   finalização exata.
3. `src/lib/checkout.ts` — tabela de finais + `suggestCheckout(score)`.
4. `src/pages/PlayPage.tsx` — 501 local 1v1/pass-and-play, teclado
   numérico grande, undo por dardo.
5. Dexie v2 — tabela `visits` (`id, matchId, playerId, darts[], score`),
   mantendo `matches` intacto para não quebrar torneios existentes.
6. Estatísticas derivadas em `src/lib/stats.ts` (sem guardar agregados).

## 8. Camera Lab — protótipo já implementado

Rota: `/camera-lab`. Entradas na UI: botão de câmara no cabeçalho de
**Tournaments** e secção **Experimental** em **Settings**. Não ocupa lugar na
navegação principal.

### O que faz

O ecrã guia **5 passos**, com barra de progresso e um único botão principal que
faz sempre a próxima ação: `Camera → Find board → Set rotation → Empty board →
Throw`.

| Passo | Comportamento |
| --- | --- |
| 1. Câmara | `getUserMedia` traseira, 1920×1080 pedidos, processamento a ~12 fps numa cópia de 640 px. Botão principal: `Start camera` |
| 2. Encontrar | `Find the board` deteta o tabuleiro (Hough + refinamento sub-pixel). Falha → `Calibrate by hand` (4 toques: 20, 6, 3, 11 na dupla exterior) |
| 3. Rotação | **A app enquadra o tabuleiro sozinha** (zoom automático, ~82% do lado menor) e pede **um toque** no meio da dupla 20, marcada com um ponto azul “20” |
| 4. Referência | `Board is empty` guarda o tabuleiro vazio como referência da diferença de frames |
| 5. Lançar | Cada dardo é falado e registado; confirmas **A** ou **B** (qual é a ponta) ou `Discard`. `Board is empty` outra vez repõe a referência entre rondas |
| Modelo | Desenha por cima do vídeo a dupla, o triplo, o bull, os 20 sectores e os números — verificação visual imediata |
| Pontuação | Tocar em qualquer ponto devolve o score exato (geometria oficial, validada com 60 pontos de referência) |
| Deteção | Diferença de frames contra a referência → componentes conexas → eixo principal → **dois candidatos** de ponta, cada um com o seu score |
| Voz | Fala em inglês o valor detetado ("triple twenty", "double five", "fifty. Bullseye.") via Web Speech API; toggle no ícone de coluna |
| Registo | Cada dardo é gravado automaticamente na sessão; um toque em **A**/**B** confirma |
| Exportação | `Export JSON` com calibração, mm/px, zoom, resumo e todos os registos — é este ficheiro que permite afinar a deteção |

### Zoom

O zoom é **digital e só de visualização**: recorta o que é mostrado e ajusta o
mapa de toques, mas a deteção continua a correr no frame inteiro. Por isso
ampliar nunca invalida a calibração nem a referência do tabuleiro vazio.

- **Ajusta-se sozinho** ao encontrar o tabuleiro (passo 3): o tabuleiro passa a
  ocupar ~82% do lado menor da imagem, para os números ficarem legíveis.
- **Depois é teu**: slider de 1× a 4×, pinça para ampliar e arrastar para mover.
  Arrastar nunca conta como toque de pontuação.
- A câmara nativa (zoom óptico do telemóvel) não é usada de propósito: expõe-se
  de forma inconsistente entre Android/iOS e tornaria a calibração dependente
  do modelo do telefone.

### Porque é que a confirmação A/B é o dado mais valioso

O detector devolve os dois extremos do dardo. O utilizador só tem de dizer qual
deles é a ponta. Depois de ~30 dardos, o JSON diz se a ponta é sempre o extremo
A (aí o app pode passar a decidir sozinho) e qual é a taxa de acerto por zona
(triplos, duplos, single). Sem esse dado, qualquer ajuste é adivinhação.

### Como testar no S24 Ultra

1. `npm run build && npx wrangler deploy` — a câmara exige HTTPS, por isso não
   dá para testar por `npm run dev` na rede local.
2. Abrir `https://darts-tournament.f-piscinato.workers.dev/camera-lab` no Chrome.
3. Telemóvel fixo, 1,5–2 m, tabuleiro a ocupar ~60% do ecrã, luz sem reflexos diretos.
4. `Start camera` → `Find the board` → tocar na dupla 20 (ponto azul “20”) →
   `Board is empty`. Usa o slider/pinça se quiseres ver o tabuleiro maior.
5. Lançar 10–15 dardos, confirmando A/B e corrigindo com um toque quando falhar.
6. `Export JSON` e enviar o ficheiro.

### Limitações conhecidas do protótipo

- **Remoção dos dardos** também gera diferença de imagem; a confirmação e o
  botão `Discard` resolvem, mas ainda não há deteção automática de "tabuleiro limpo".
- **Uma câmara**: sem visão estéreo, a ponta exata depende do eixo do dardo.
- **Sem modelo treinado**: é CV clássico, sensível a sombras fortes e reflexos.
- **Mãos/braços**: blocos fora do tabuleiro já são filtrados, mas movimento
  grande (>8% do frame) limpa a deteção desse frame.
