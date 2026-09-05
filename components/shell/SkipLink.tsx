import styles from "./SkipLink.module.css";

/**
 * Keyboard skip link. Off-screen until focused, then visible in the top-left of
 * the page. Every screen renders one as its first focusable element and every
 * screen has a matching `<main id="main">`.
 */
export function SkipLink() {
  return (
    <a className={styles.skip} href="#main">
      Skip to main content
    </a>
  );
}
