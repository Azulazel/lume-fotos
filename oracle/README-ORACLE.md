# Lume — backend Oracle

Frontend: GitHub Pages. API: https://lume.163.176.48.125.sslip.io/api. Servidor: Ubuntu ARM, 163.176.48.125. A API usa FastAPI, SQLite WAL e NumPy. Os descritores continuam sendo produzidos por face-api.js no navegador; a comparação acontece no servidor, sem enviar ou armazenar a selfie.

## Serviços e dados

- Código: /opt/lume; serviço systemd lume; usuário sem shell lume.
- SQLite: /var/lib/lume/lume.sqlite; fotos: /var/lib/lume/photos. Nenhum desses diretórios é servido pelo Nginx.
- Segredos: /etc/lume.env, somente root. Nunca publicar esse arquivo.
- HTTPS: Nginx + Certbot, renovação automática. DNS gratuito sslip.io depende de manter o IP público atual.
- Logs: journalctl -u lume. Logs de acesso da API foram desativados para não registrar links assinados. Logs de erro de infraestrutura ainda podem existir.
- Backups diários do banco: /var/lib/lume/backups, 14 dias. As fotos não são duplicadas. Esses snapshots estão no mesmo disco e NÃO protegem contra perda da VM; configure cópia externa antes de depender do sistema para arquivos insubstituíveis.

## Migração

Enquanto não existe administrador local, o primeiro login aceita somente uma conta que já tenha permissão de admin no Supabase original. O servidor valida a senha com Supabase Auth, copia eventos, fotos privadas e descritores e grava o administrador local com hash PBKDF2-SHA256. Essa cópia é somente leitura na origem. Após o sucesso, login, eventos, uploads e busca usam apenas a Oracle. A senha é a mesma utilizada nesse primeiro acesso. O banco de destino é confirmado em uma transação; falhas não removem dados da origem. Evite novos uploads no Supabase durante a transferência; não há sincronização contínua. Apenas a primeira conta admin é importada.

## Segurança e limites

Sessões aleatórias de 12 horas, armazenadas como hashes no banco e sessionStorage no navegador. Limite de login: 6/minuto por IP; busca: 12/minuto. Bucket privado substituído por arquivos privados e links HMAC de 10 minutos. Upload máximo 15 MB por arquivo, 100 rostos por imagem; o disco mantém reserva de 2 GiB. A busca processa descritores em lotes de 1000 e retorna até 100 fotos. Não existe limite comercial de 20 GB: o armazenamento acompanha o disco disponível, descontados sistema, banco e reserva.

Reconhecimento facial não autentica identidade e pode ter falsos positivos. Não use para conteúdo confidencial. Câmera exige HTTPS e autorização do visitante. O painel permite excluir fotos e descritores; exclusão de eventos inteiros ainda não está implementada.

## Validação

backend/test_server.py usa diretório temporário: autenticação, logout, criação de evento, upload, publicação, busca positiva/negativa, assinatura de URL, remoção com cascata, imagem inválida e rate limit. Executar: cd backend && /opt/lume/venv/bin/python test_server.py.

## Rollback

O Supabase original permanece preservado. A versão anterior no GitHub é f63b7bd805a572623652face6872f2e60194a67a. Restaurar app.js, index.html e config.js desse commit volta a apontar para o Supabase. Fotos novas enviadas à Oracle não são automaticamente copiadas de volta.

## Otimização de lotes

JPEG: alta qualidade (até 4000 px, qualidade do codificador 0,94), mais rápido (2560 px, 0,90) ou original. A recompressão é com perdas e remove metadados; a opção original preserva os bytes. PNG e WebP não são alterados. Só é enviada a versão comprimida quando economiza mais de 10%; imagens abaixo de 350 KB são preservadas. A compressão usa Web Worker e OffscreenCanvas; se indisponíveis, mantém o original. O reconhecimento analisa a imagem original. Até dois uploads são executados em paralelo com preparação limitada, e falhas individuais não interrompem o lote. A interface mostra tempo, tamanho enviado e economia real. Miniaturas de 640 px são geradas na Oracle para as grades; abrir/baixar usa a imagem enviada. Testes adicionais: node test-upload.mjs.
