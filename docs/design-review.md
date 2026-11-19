# Plano único de melhoria visual e de uso do StremCompat

## Objetivo

Melhorar a leitura à distância, facilitar decisões com o controle remoto e dar mais consistência às telas, sem aumentar o uso de memória ou o trabalho gráfico nas TVs antigas.

## Mudanças gerais

1. **Reorganizar a tipografia em 720p.** Usar aproximadamente 18–20 px nas informações que precisam ser lidas do sofá, como metadados, avisos e títulos de episódios. Reservar 14–16 px para selos acessórios. Criar tamanhos próprios para a opção “texto maior” em 720p, evitando cortes e sobreposições.
2. **Aumentar o contraste do texto secundário.** Clarear dicas, descrições de addons, informações do próximo episódio e mensagens de estado. Usar o peso 700 apenas em títulos, ações e dados decisivos; usar 400 no texto complementar.
3. **Dar uma função consistente a cada cor.** Usar branco para o foco atual, verde-água para seleção e progresso, âmbar para atenção e vermelho para erro. Diferenciar os estados também por texto ou forma.
4. **Padronizar foco, seleção e edição.** Aplicar a mesma lógica visual à barra lateral, filtros, cartões, botões e Ajustes. O foco deve ser reconhecível imediatamente, sem deslocar controles vizinhos.
5. **Uniformizar recuos e espaços.** Alinhar cabeçalhos, filtros e conteúdo entre as telas e reservar margem para possíveis cortes nas bordas da TV. Rever títulos longos em português antes de ampliar qualquer fonte.
6. **Padronizar carregamento, ausência de conteúdo e erro.** Mostrar mensagens curtas e ações claras, como “Tentar novamente”, na mesma posição e com o mesmo nível de destaque em telas equivalentes.

## Mudanças por tela

- **Home:** reduzir o texto do destaque para uma sinopse curta e metadados úteis à escolha. Dar à primeira fileira uma separação mais clara do destaque, sem aumentar a área ocupada por imagens.
- **Detalhes:** colocar título, dados essenciais, sinopse e ação principal no primeiro nível. Rebaixar elenco, autores, país e prêmios para um bloco secundário. Tornar a sequência entre ações, temporadas e episódios mais fácil de acompanhar.
- **Fontes:** ordenar cada opção por compatibilidade, resolução, idioma, tamanho e addon; deixar o nome técnico longo em segundo plano. Distinguir explicitamente “fonte preferida” de “compatibilidade confirmada” e manter os avisos técnicos visíveis.
- **Discover:** tornar o filtro aplicado mais evidente e reforçar a leitura dos títulos sobre cartazes claros. Conferir se a seleção continua clara após abrir e fechar um menu de filtros.
- **Busca:** destacar o campo de busca e tornar **Espaço**, **Apagar** e **Limpar** legíveis em 720p. Separar visualmente buscas recentes dos resultados e mostrar o estado da pesquisa sem ocupar espaço permanente.
- **Ajustes:** colocar opções de uso frequente antes das ações técnicas; separar manutenção e diagnóstico com maior clareza. Melhorar a leitura das dicas e diferenciar visualmente uma linha selecionada de uma linha em edição.
- **Login:** dar prioridade visual ao acesso por QR code e reduzir a competição visual com o formulário de e-mail.
- **Player:** ordenar título, tempo, controles, avisos e próximo episódio quando aparecerem juntos. Aumentar a legibilidade dos textos pequenos e evitar que avisos escondam a ação em foco.

## Critérios de aceitação

Verificar cada tela em **1280×720 e 1920×1080**, com textos longos em português e com a opção “texto maior”. Testar navegação rápida, foco e retorno pelo controle remoto no Chromium 38 e em uma TV física. Comparar tempo de resposta do foco, fluidez e memória antes e depois; revisar qualquer mudança que cause regressão. Implementar os ajustes com texto, espaçamento, cores e formas simples, sem acrescentar imagens de alta resolução ou efeitos gráficos.