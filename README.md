# Pista · calendário e resultados de salto

App web (PWA) com o calendário de torneios de salto, resultados prova a prova, ranking da
temporada e perfis de cavaleiros e cavalos. Os dados vêm das páginas públicas de torneios da
Federação Paulista de Hipismo e são atualizados sozinhos algumas vezes por dia.

**Projeto em testes, sem vínculo com a FPH ou a CBH.** O resultado oficial de cada prova está
sempre a um toque de distância, pelo link que aparece no rodapé da tela de resultado.

## Como funciona

- `index.html` — o app inteiro num arquivo só (HTML, CSS e JavaScript). Não precisa de servidor:
  ele lê os arquivos de dados da pasta `data/hipica/`.
- `scripts/hipica/` — o coletor, em Node. Lê as páginas de torneio da FPH, entende as provas e os
  resultados e grava os dados em `data/hipica/`.
- `.github/workflows/coletar-hipica.yml` — roda o coletor várias vezes por dia pelo GitHub Actions
  (quem dispara é o agendador do Supabase) e publica o que mudou.
- `scripts/hipica/vigiar.mjs` — o vigia: no fim de cada rodada, até quando a coleta quebra, confere
  se algo saiu do normal e abre um aviso (issue) no GitHub, com a etiqueta `alerta-coletor`. O aviso
  se fecha sozinho quando o problema passa 30 minutos sem aparecer. Só números e endereços da FPH,
  nunca nomes.

### Dados gerados

| Arquivo | O que tem |
| --- | --- |
| `data/hipica/index.json` | lista de torneios, com suas provas |
| `data/hipica/t/<id>.json` | classificação de cada prova do torneio |
| `data/hipica/stats.json` | ranking da temporada e totais |
| `data/hipica/perfis/` | perfis de cavaleiros e cavalos, divididos por letra |
| `data/hipica/busca.json` | índice leve para busca |
| `data/hipica/estado.json` | controle interno do coletor (o que já foi lido) |

## Rodar na sua máquina

```bash
# o app (precisa de um servidor local; abrir o arquivo direto não funciona bem)
python3 -m http.server 8000
# depois abra http://localhost:8000

# o coletor
cd scripts/hipica
npm install
node coletar.mjs
```

Variáveis úteis para o coletor: `A_PARTIR` (data de corte, padrão `2026-01-01`), `MAX_PAGINAS`,
`MAX_MINUTOS`, `INTERVALO_MS` (pausa entre páginas) e `BASE_URL`.

## Cuidados adotados

- O coletor respeita o `robots.txt`, lê uma página por vez com pausa entre elas e não volta a
  baixar resultados de torneios já encerrados.
- Em provas de categorias infantis, o sobrenome do atleta aparece abreviado.
- O ranking é uma contagem própria deste projeto e não substitui o ranking oficial da federação.
- O app não tem cadastro nem servidor próprio: o que você salva e segue fica só no seu navegador.
