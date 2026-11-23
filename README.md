# Funil de Leads da Comunicação

Sistema web da equipe de comunicação e marketing para lançar leads, acompanhar o funil (em contato → agendado → presença/falta) e, na área administrativa, conferir presenças, valores e metas.

- **Site:** https://top-desenvolvimento.github.io/funil-leads-comunicacao/
- **Como colocar no ar:** veja [LEIA-ME.md](LEIA-ME.md)

> Este repositório guarda **só o código**. Leads, telefones, valores e metas ficam no Firebase, protegidos por login Google e pelas regras de acesso. Nunca envie para cá o arquivo de backup (`backup-funil-leads-*.json`).

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | Redireciona para o sistema. |
| `sistema/index.html` | O aplicativo inteiro (telas, regras, gráficos, exportação). |
| `sistema/shim.js` | Ligação com o Firebase (login Google, banco de dados, downloads, restaurar backup). |
| `sistema/config.js` | **Preencher**: e-mail da dona e dados do projeto Firebase. |
| `sistema/firestore.rules` | **Preencher**: regras de acesso; colar no Firebase. |
| `robo/CONFERIR_PRESENCAS.md` | Procedimento do robô que confere presenças no sistema da clínica. |

## Abas

- **Início**: resumo do dia, do mês atual, melhor mês do ano e trimestre.
- **Lançamentos**: cadastro e atualização dos leads, filtros, conferência por filtro e por integrante, exportação em Excel/PDF.
- **Funil**: gasto × entrou, evolução mensal e trimestral, relatórios por cidade, canal, interesse e integrante.
- **Administrativo** (dona e gestor comercial): pedidos de exclusão, investimento, valores das presenças, conferência de limpeza e procedimentos, metas, backup.

## Regras de negócio

- **Lead repetido**: se um telefone já lançado em mês anterior entra no mês atual, o lançamento antigo fica riscado e o novo recebe a observação "Lead de <mês>".
- **Exclusão**: a equipe só *solicita* exclusão com motivo; a administração aprova ou recusa.
- **Metas da equipe** (por quem agendou, no mês da consulta): R$ 5 por presença; + R$ 5 quando é limpeza (valor ≥ R$ 219, confirmada pelo gestor); R$ 1 por procedimento pago no mês.
- **Meta da Juliana (MKT)**: R$ 2 por presença vinda das mídias (Principal, Paralela, Site, Empresas, Google, YouTube, TikTok, Pinterest, Instagram, Facebook, WhatsApp dos anúncios, Anúncio Juli).

## Banco de dados (Firestore)

| Caminho | Conteúdo | Acesso |
|---|---|---|
| `m/<AAAA-MM>/leads/<id>` | Leads do mês | equipe |
| `hist/<AAAA-MM>` | Histórico jan–out/2026 (somente leitura) | equipe lê |
| `risc/<AAAA-MM>` | Lançamentos do histórico riscados | equipe |
| `solic/<id>` | Pedidos de exclusão | equipe cria; adm decide |
| `adm/<AAAA-MM>` | Investimento, valores por paciente, metas | dona e gestor |
| `pub/<AAAA-MM>` | Totais do mês (investido, entrou) | equipe lê; adm grava |
| `cfg/acesso`, `sys/*`, `legado/*`, `perfis/*` | Configurações e nomes | ver `firestore.rules` |

comercial
