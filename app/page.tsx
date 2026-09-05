import Link from "next/link";

/**
 * Public home — `/` (docs/FOODPROOF_SCREENS.md §1).
 * Static introduction. No pilot-data query, no live activity counts, no report
 * previews. Navigation follows the approved Clear Signal preview (D31); there is
 * no login link in phase one. No government logo, guaranteed outcome, safety
 * lookup, endorsement, or invented statistic. The contact route is configured
 * by the owner, never invented here.
 */
export default function HomePage() {
  return (
    <>
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

      <main>
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

        <section className="section container" aria-label="What FoodProof does">
          <div className="pillars">
            <div className="pillar">
              <h3>Document</h3>
              <p>Label photos and a plain-language concern, kept private first.</p>
            </div>
            <div className="pillar">
              <h3>Take action</h3>
              <p>Prepare a factual draft and send it through your own channels.</p>
            </div>
            <div className="pillar">
              <h3>Follow the record</h3>
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
            Pilot notice: this is an invited demo using sample or redacted
            information. Illustrative example only.
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
            Contact route: to be configured by the product owner before the
            invited pilot.
          </p>
        </div>
      </footer>
    </>
  );
}
