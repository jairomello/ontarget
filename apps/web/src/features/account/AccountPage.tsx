import { ApiKeysSection } from "./ApiKeysSection";
import { AppearanceSection } from "./AppearanceSection";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";
import styles from "./account.module.css";

/**
 * Página de conta (specs/user-profile — "Página de conta"): perfil, senha,
 * aparência e chaves, dentro do shell da aplicação.
 */
export function AccountPage() {
  return (
    <div className={styles.page} data-testid="account-page">
      <header className={styles.header}>
        <h1>Conta</h1>
        <p>Perfil, senha, aparência e chaves desta instalação.</p>
      </header>

      <ProfileSection />
      <PasswordSection />
      <AppearanceSection />
      <ApiKeysSection />
    </div>
  );
}
