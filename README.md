# Lume Fotos

Plataforma de fotografia de eventos: o administrador envia lotes de fotos e os visitantes encontram possíveis fotos suas a partir de uma selfie, escolhida da galeria ou capturada pela câmera.

## Origem

Adaptação do fluxo de reconhecimento do [arifszn/find-me](https://github.com/arifszn/find-me), licença MIT, commit 85e47be58c13d218aa48c158809ead4f609975f2. Uma cópia dos fontes originais está em upstream/find-me; a interface e a integração com Supabase foram reimplementadas para suportar eventos, administração e armazenamento privado. A licença original foi preservada. Os modelos vêm do mesmo commit, pelo CDN jsDelivr. face-api.js 0.22.2 é usado somente para detecção, pontos faciais e descritores, sem classificação demográfica.

## Arquitetura

- Frontend estático no GitHub Pages, sem build.
- Supabase Auth: login do fotógrafo por e-mail e senha.
- Postgres + pgvector: eventos, fotos e descritores de 128 dimensões.
- Storage privado: event-photos; uploads limitados a JPG, PNG e WebP, 15 MB.
- Edge Function search-photos: busca por distância euclidiana inferior a 0,52, até 100 resultados, URLs assinadas por 10 minutos, limite de 12 consultas/minuto por hash de IP.
- Fotos e descritores não têm leitura anônima. Somente eventos publicados são listados publicamente. As funções SQL de busca só podem ser chamadas pelo service_role no servidor.

## Configuração em um projeto novo

1. Execute supabase/schema.sql no SQL Editor, uma vez.
2. Crie sua conta em Authentication > Users > Add user no painel Supabase. Defina a senha pessoalmente.
3. Promova somente seu usuário, substituindo o UUID: INSERT INTO public.admins(user_id) VALUES ('UUID-DO-SEU-USUARIO');
4. Publique supabase/functions/search-photos/index.ts como Edge Function chamada search-photos. Mantenha Verify JWT ativado e utilize a chave pública legacy anon no frontend (a função recebe consultas públicas, valida o corpo e aplica limite de requisições). SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidas pelo ambiente do Supabase; nunca as copie para o frontend.
5. Preencha config.js com a URL do projeto e a chave pública anon/publishable. Não use chave secreta.
6. GitHub > Settings > Pages > Deploy from a branch > main > /(root).

## Uso

Abra #admin, faça login, crie um evento, confirme a autorização dos participantes e envie várias fotos. Aguarde o lote terminar: a análise é sequencial no navegador do administrador. Fotos sem rostos detectáveis não são enviadas. Confira o relatório individual de falhas. Publique o evento e use Copiar link para divulgar a galeria.

O visitante seleciona o evento, confirma que está buscando suas próprias fotos e escolhe uma imagem com um único rosto ou usa a câmera. A selfie não sai do dispositivo; o descritor é enviado para uma consulta e não é persistido. Limpar minha busca remove a prévia e os resultados da página. As fotos do evento e seus descritores permanecem até exclusão pelo fotógrafo. A exclusão de uma foto também remove seus descritores.

## Desenvolvimento

Node 20+; npm start abre http://127.0.0.1:4173. npm run check valida a sintaxe. Não é necessário instalar dependências para servir o frontend. Dependências e modelos têm versões fixadas em CDN; sua disponibilidade depende de conexão com a internet.

## Limites conhecidos

A correspondência facial não é autenticação nem prova de identidade; pode falhar com rostos pequenos, iluminação ruim, perfis e pessoas parecidas. Não use para galerias confidenciais ou decisões sobre pessoas. Quem possui uma foto de alguém pode tentar uma busca. URLs assinadas podem ser compartilhadas até expirar. A selfie é descartada, mas as plataformas de infraestrutura podem reter metadados técnicos de requisição. Ajuste política de retenção e atendimento a pedidos de exclusão antes de operar eventos reais. O limite de requisições usa o IP encaminhado pelo gateway e não substitui proteção contra abuso em grande escala. A grade do administrador mostra as 200 fotos mais recentes e a busca retorna até 100 correspondências; grandes eventos precisam de paginação e processamento em servidor. Uploads em segundo plano não sobrevivem ao fechamento da aba.

## Créditos visuais

Fotografias ilustrativas servidas pelo Unsplash. Elas não são resultados de busca nem dados de participantes. Fontes DM Sans e Playfair Display via Google Fonts.
