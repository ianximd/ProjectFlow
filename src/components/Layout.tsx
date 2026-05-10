import { LayoutDashboard, CheckSquare, Settings, Users } from 'lucide-react';
import styles from './Layout.module.css';

interface Props {
  children: React.ReactNode;
}

export function Layout({ children }: Props) {
  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>PM</div>
          <span className={styles.logoText}>ProjectManager</span>
        </div>
        
        <nav className={styles.nav}>
          <a href="#" className={`${styles.navItem} ${styles.active}`}>
            <LayoutDashboard size={18} />
            Board
          </a>
          <a href="#" className={styles.navItem}>
            <CheckSquare size={18} />
            My Issues
          </a>
          <a href="#" className={styles.navItem}>
            <Users size={18} />
            Team
          </a>
          <a href="#" className={styles.navItem}>
            <Settings size={18} />
            Settings
          </a>
        </nav>
      </aside>
      
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.breadcrumbs}>
            Projects / Frontend Redesign / Kanban Board
          </div>
          <h1 className={styles.pageTitle}>Kanban Board</h1>
        </header>
        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  );
}
