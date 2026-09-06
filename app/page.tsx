import Link from "next/link";
import { SkipLink } from "@/components/shell/SkipLink";
import styles from "@/components/shell/HomePage.module.css";

/**
 * Public home — `/` (docs/FOODPROOF_SCREENS.md §1).
 * Static introduction. No pilot-data query, no live activity counts, no report
 * previews. Navigation follows the approved Clear Signal preview (D31); there is
 * no login link in phase one. No government logo, guaranteed outcome, safety
 * lookup, endorsement, or invented statistic. The contact route is configured
 * by the owner, never invented here: this page points at the channel an
 * invitation arrived through rather than publishing an address of its own.
 */
export default function HomePage() {
  return (
    <>
      <SkipLink />
      <header className="site-header container">
        <span className="wordmark">
          <strong>Food</strong>Proof
        </span>
        <nav className="nav-links" aria-label="Primary">
          <a href="#how">How it works</a>
          <Link className="btn-primary" href="/pilot">
            Enter pilot
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="hero container">
          <h1>Food labels deserve a closer look.</h1>
          <p className="hero-sub">
            Document a concern. Prepare a complaint. Give the community a clearer
            picture.
          </p>
          <div className="hero-actions">
            <Link className="btn-primary" href="/pilot">
              Enter invited pilot
            </Link>
            <a className="link-cta" href="#how">
              How it works ↓
            </a>
          </div>
        </section>

        <section className="container" aria-label="What a label concern looks like">
          <figure className={styles.figure}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static local asset, explicit intrinsic size, no loader needed */}
            <img
              className={styles.image}
              src="/illustrative-label.jpg"
              width={1100}
              height={825}
              loading="lazy"
              decoding="async"
              alt="A kraft pouch whose paper label reads SAMPLE PANTRY, GLUTEN-FREE. A magnifying glass rests over the ingredient list below it, where wheat flour is highlighted."
            />
            <figcaption className={styles.caption}>
              <span className={styles.captionTag}>Illustrative example</span>A fictional label
              made for this project, not a photograph of a real product. It shows the kind of
              contradiction a reporter might document; it is not an allegation about any real
              brand.
            </figcaption>
          </figure>
        </section>

        <section className="section container" aria-label="What FoodProof does">
          <div className="pillars">
            <div className="pillar">
              <h2>Document</h2>
              <p>Label photos and a plain-language concern, kept private first.</p>
            </div>
            <div className="pillar">
              <h2>Take action</h2>
              <p>Prepare a factual draft and send it through your own channels.</p>
            </div>
            <div className="pillar">
              <h2>Follow the record</h2>
              <p>Record responses and share reviewed concerns with the community.</p>
            </div>
          </div>
        </section>

        <section className="section container" id="how">
          <h2>How FoodProof complements official channels</h2>
          <div className="compare">
            <div>
              <h3>FoodProof</h3>
              <p className="muted">
                Organize evidence, prepare messages, and share reviewed concerns
                with the community.
              </p>
            </div>
            <div>
              <h3>Official portals</h3>
              <p className="muted">
                Submit complaints through the responsible government authority.
              </p>
            </div>
          </div>
          <p className="notice">
            Publishing here does not file a government complaint, and FoodProof
            does not certify that a product is safe.
          </p>
        </section>

        <section className="section container" aria-label="Pilot notice">
          <p className="notice">
            Pilot notice: this is an invited demo. Everything inside it — products,
            brands, concerns and responses — is an illustrative example using sample
            or redacted information. Nothing in the pilot describes a real complaint
            about a real company.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>
            FoodProof is an independent project with no government affiliation. It
            does not file complaints, guarantee responses, or look up product
            safety.
          </p>
          <p className="muted">
            Built for the celiac community in India. If you were invited to the
            pilot, reply through the same channel your invitation arrived on; there
            is no public contact address for this phase.
          </p>
        </div>
      </footer>
    </>
  );
}
