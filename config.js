/* ============================================================
   CONFIGURAÇÃO DO SISTEMA
   ============================================================ */
window.FUNIL_CONFIG = {
  // Dona do sistema (Nicele): acesso total + restaurar backup e definir gestores.
  donaEmail: "topesteticabucal.gerencia2@gmail.com",

  // Acesso total (Início, Lançamentos, Funil e Administrativo).
  // Precisa ser igual à lista acessoTotal() do firestore.rules.
  acessoTotal: [
    "topesteticabucal.gerencia3@gmail.com",   // Thainá Freitas – gerente
    "gerencia.topcaxias@gmail.com"            // Marina Finco – diretora
  ],

  // Dados do projeto Firebase
  firebase: {
    apiKey: "AIzaSyBeih0H3P9QFDlk9vri-A6riZD_r1188-I",
    authDomain: "funil-leads-comunicacao.firebaseapp.com",
    projectId: "funil-leads-comunicacao",
    storageBucket: "funil-leads-comunicacao.firebasestorage.app",
    messagingSenderId: "549901512256",
    appId: "1:549901512256:web:8392058c25c4704ac8f9a5"
  }
};
