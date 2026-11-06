# Guirab Placas

Sistema de gestão de placas NFC e QR Code para avaliações de estabelecimentos no Google.

**Site:** https://placas.guirab.com.br/  
**Responsável:** [Guilherme Rabelo](https://github.com/guirab734)

## Funcionalidades

- Estoque com códigos curtos e links permanentes individuais.
- Geração de lotes para imprimir antes da venda e configurar depois.
- Cadastro de estabelecimentos, contatos, localização e histórico.
- Conversão de links do Google Maps para avaliação quando identificáveis.
- Contagens manuais de avaliações e acompanhamento do crescimento.
- Mapa de prospecção, limites de regiões, seleção de ruas e pintura de áreas visitadas.
- PDFs vetoriais com duas placas por folha A4, arquivos individuais e imagens PNG/ZIP.
- Arte ajustada para 12,4 × 14,4 cm, sem identificação no rodapé impresso.
- Administração protegida por senha e redirecionamentos públicos para clientes.
- Interface responsiva com modos claro e escuro.

## Tecnologias

React, TypeScript, Vinext/Vite, Cloudflare Workers e D1, Drizzle, Leaflet, jsPDF e SVG.

## Desenvolvimento

Requer Node.js 22.13 ou superior.

```sh
npm ci
npm run dev
```

Para gerar o build:

```sh
npm run build
```

O desenvolvimento local usa `.dev.vars`, ignorado pelo Git. Configure `ADMIN_PASSWORD_HASH`, `ADMIN_RATE_KEY`, `ADMIN_OWNER_ID` e `PUBLIC_REDIRECTS` conforme o ambiente. O utilitário `scripts/create-admin-secrets.mjs` prepara o hash e a chave de administração recebendo a senha por entrada oculta; não coloque a senha no código.

A chave `GOOGLE_PLACES_API_KEY` é opcional e necessária apenas para a integração oficial com Google Places. O cadastro e as contagens manuais funcionam sem essa integração.

## Estrutura

- `app/`: telas, componentes, rotas e regras do aplicativo.
- `public/`: arte vetorial das placas, fontes e demais recursos.
- `db/` e `drizzle/`: esquema e migrações do banco.
- `scripts/`: desenvolvimento, build e verificações.
- `build/`: código de integração e execução da hospedagem.
- `.openai/hosting.json`: identificação e vínculos da hospedagem atual.

Este repositório contém o código e os recursos do projeto. Credenciais, banco local, dependências instaladas, caches e pacotes de publicação não são versionados. O banco e os segredos de produção continuam na hospedagem.

As licenças de fontes e componentes de terceiros estão preservadas nos respectivos diretórios.
