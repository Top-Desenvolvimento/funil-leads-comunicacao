# Como colocar o Funil de Leads no ar

O código já está neste repositório. Faltam o **Firebase** (banco de dados + login Google) e ligar o **site**.
Depois disso, a equipe usa o sistema pelo link https://top-desenvolvimento.github.io/funil-leads-comunicacao/ com a conta Google de cada um, sem abrir o Claude.
Tempo estimado: 30 minutos, uma vez só. Gratuito no volume da clínica.

---

## Passo 1 – Baixar o backup dos dados (no app atual do Claude)
1. Abra o app atual no Claude → aba **Administrativo** → fim da página, cartão **"Quem acessa o Administrativo"**.
2. Clique em **Baixar backup completo (JSON)** e guarde o arquivo.
3. **Não** envie esse arquivo para o GitHub: ele tem telefones de pacientes.

## Passo 2 – Criar o projeto no Firebase
1. Entre em https://console.firebase.google.com com a conta Google da clínica → **Adicionar projeto** (ou **Criar um projeto**) → nome `funil-leads` → pode desativar o Google Analytics → **Criar projeto**.
2. Menu da esquerda **Criação → Authentication → Vamos começar** → em "Provedores", **Google** → **Ativar** → escolha o e-mail de suporte → **Salvar**.
3. Ainda em Authentication → aba **Configurações → Domínios autorizados → Adicionar domínio** → digite `top-desenvolvimento.github.io` → **Adicionar**.
4. Menu **Criação → Firestore Database → Criar banco de dados** → local `southamerica-east1 (São Paulo)` → **Iniciar no modo de produção** → **Criar**.
5. No Firestore, aba **Regras**: apague tudo e cole o conteúdo do arquivo [`sistema/firestore.rules`](sistema/firestore.rules). Troque:
   - `COLE-AQUI-O-SEU-EMAIL@gmail.com` pelo seu e-mail Google;
   - os e-mails de exemplo pelos e-mails Google do Vinícius, da Samara, do Bernardo e do gestor comercial.

   Clique em **Publicar**.
6. Engrenagem ⚙ (ao lado de "Visão geral do projeto") → **Configurações do projeto** → em "Seus apps" clique no ícone **</>** (Web) → apelido `funil` → **Registrar app**. Aparece um bloco `const firebaseConfig = { apiKey: "...", ... }`. Deixe essa tela aberta.

## Passo 3 – Preencher o config.js (direto no GitHub)
1. Abra [`sistema/config.js`](sistema/config.js) aqui no GitHub → clique no **lápis** (Edit this file).
2. Troque `COLE-AQUI-O-SEU-EMAIL@gmail.com` pelo seu e-mail.
3. Copie cada valor do `firebaseConfig` (passo 2.6) para o lugar correspondente: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
4. Clique em **Commit changes… → Commit changes**.

> Esses dados do Firebase podem ficar públicos: eles só identificam o projeto. Quem protege os dados é o login e as regras do passo 2.5.

## Passo 4 – Ligar o site (GitHub Pages)
1. No repositório: **Settings → Pages** (menu da esquerda).
2. Em "Build and deployment": **Source: Deploy from a branch** → **Branch: main** → pasta **/ (root)** → **Save**.
3. Em 1–2 minutos o site fica no ar em https://top-desenvolvimento.github.io/funil-leads-comunicacao/

## Passo 5 – Primeiro acesso e restauração dos dados
1. Abra o site → **Entrar com Google** com o seu e-mail (o mesmo do config.js).
2. Aba **Administrativo** → fim da página → **Restaurar backup…** → escolha o arquivo do passo 1. A página recarrega sozinha com todos os dados.
3. Peça para o gestor comercial entrar uma vez no site e depois marque o nome dele em **Quem acessa o Administrativo**.
4. Mande o link para a equipe. Cada um entra com a própria conta Google (o e-mail precisa estar na lista do passo 2.5).

## No dia a dia
- **Entrou alguém na equipe?** Firebase → Firestore → Regras → acrescente o e-mail na lista → **Publicar**.
- **Alguém saiu?** Tire o e-mail da lista e publique.
- **Mensagem "Acesso não liberado"?** O e-mail da pessoa não está na lista das regras.

## O que continua dependendo do Claude
- O **robô de conferência de presenças** ([`robo/CONFERIR_PRESENCAS.md`](robo/CONFERIR_PRESENCAS.md)) é feito pelo Claude, abrindo o sistema da clínica no seu navegador; para gravar neste sistema ele precisa ser adaptado ao Firebase.
- Mudanças e melhorias no código.
