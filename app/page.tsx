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
 *
 * The page reads in the order a visitor with celiac disease needs it: what the
 * evidence looks like (the photograph is in the hero, not below it), what
 * FoodProof does with it, the four steps of the journey the app actually
 * implements, where FoodProof stops and official filing begins, and last what
 * the pilot itself is.
 */
export default function HomePage() {
  return (
    <>
      <SkipLink />
      <header className="site-header">
        <div className="container site-header-inner">
          <span className="wordmark">
            <strong>Food</strong>Proof
          </span>
          <nav className="nav-links" aria-label="Primary">
            <a href="#how">How it works</a>
            <Link className="btn-primary" href="/pilot">
              Enter pilot
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className={`route-reveal ${styles.main}`}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <h1 id="hero-title" className={styles.heroTitle}>
              Food labels deserve a{" "}
              <span className={styles.mark}>closer look.</span>
            </h1>
            <p className={styles.heroSub}>
              Document a concern. Prepare a complaint. Give the community a
              clearer picture.
            </p>
            <div className={styles.heroActions}>
              <Link className="btn-primary" href="/pilot">
                Enter invited pilot
              </Link>
              <a className={styles.heroLink} href="#how">
                How it works
              </a>
            </div>
            <p className={styles.heroNote}>
              A community project for people with celiac disease in India, and
              for the people who shop and cook for them.
            </p>
          </div>

          <figure className={styles.figure}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static local asset, explicit intrinsic size, no loader needed */}
            <img
              className={styles.image}
              src="/illustrative-label.jpg"
              width={1100}
              height={825}
              /*
               * This photograph is the argument the page makes and it sits above
               * the fold, so it loads eagerly at high priority instead of
               * waiting for a scroll it will never see. The intrinsic size is
               * declared, so it reserves its box and nothing shifts.
               */
              loading="eager"
              fetchPriority="high"
              decoding="async"
              alt="A kraft pouch whose paper label reads SAMPLE PANTRY, GLUTEN-FREE. A magnifying glass rests over the ingredient list below it, where wheat flour is highlighted."
            />
            <figcaption className={styles.caption}>
              <span className={styles.captionTag}>Illustrative example</span>A
              fictional label made for this project, not a photograph of a real
              product. It shows the kind of contradiction a reporter might
              document; it is not an allegation about any real brand.
            </figcaption>
          </figure>
        </section>

        <section className={styles.explain} aria-labelledby="explain-title">
          <h2 id="explain-title" className={styles.explainTitle}>
            The front says{" "}
            <span className={styles.nowrap}>gluten-free.</span> The ingredient
            list says wheat flour.
          </h2>
          <div className={styles.explainBody}>
            <p>
              FoodProof is where that observation goes. You photograph the front
              claim, the ingredient list and something that identifies the pack,
              and you write down in your own words what does not add up. It
              stays private while you work on it.
            </p>
            <p>
              From those facts FoodProof prepares a factual complaint. You read
              it, change anything you want, and send it yourself: to the brand,
              or through the official FSSAI grievance portal. FoodProof never
              sends anything for you.
            </p>
            <p>
              Then you record what came back, and when. If you decide to share
              the concern, a reviewer checks it first, and a redacted version
              joins the community record, so the next person can see that the
              same product has come up before.
            </p>
          </div>
        </section>

        <section className={styles.how} id="how" aria-labelledby="how-title">
          <h2 id="how-title" className={styles.howTitle}>
            How it works
          </h2>

          <ol className={styles.steps}>
            <li className={styles.step}>
              <span className={styles.stepIndex} aria-hidden="true">
                1
              </span>
              <div className={styles.stepBody}>
                <h3>Photograph the label</h3>
                <p>
                  The claim on the front, the full ingredient list, and
                  something that identifies the product: its name, variant,
                  batch or your receipt. Then say in your own words what does
                  not add up.
                </p>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepIndex} aria-hidden="true">
                2
              </span>
              <div className={styles.stepBody}>
                <h3>Prepare the complaint</h3>
                <p>
                  FoodProof drafts a factual message from the facts you
                  confirmed. You review and edit it, then send it yourself
                  through your own email or the official FSSAI grievance portal.
                  Nothing is sent for you.
                </p>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepIndex} aria-hidden="true">
                3
              </span>
              <div className={styles.stepBody}>
                <h3>Track what happens</h3>
                <p>
                  Record every submission and every reply on the report&rsquo;s
                  own timeline, with the brand and the authority kept apart.
                  Close the concern when you are done with it, or reopen it if
                  it starts again.
                </p>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepIndex} aria-hidden="true">
                4
              </span>
              <div className={styles.stepBody}>
                <h3>Share, if you choose</h3>
                <p>
                  Sharing is a separate decision, asked once and never assumed.
                  A reviewer checks the report, and only then does a redacted
                  version appear in the community feed.
                </p>
              </div>
            </li>
          </ol>

          <div className={styles.boundary}>
            <h3 className={styles.boundaryTitle}>
              How FoodProof complements official channels
            </h3>
            <dl className={styles.boundaryList}>
              <div className={styles.boundaryRow}>
                <dt>FoodProof</dt>
                <dd>
                  Organize evidence, prepare messages, and share reviewed
                  concerns with the community.
                </dd>
              </div>
              <div className={styles.boundaryRow}>
                <dt>Official portals</dt>
                <dd>
                  Submit complaints through the responsible government
                  authority.
                </dd>
              </div>
            </dl>
            <p className={styles.boundaryNote}>
              Publishing here does not file a government complaint or certify a
              product safe.
            </p>
          </div>
        </section>

        <section className={styles.pilotBand} aria-labelledby="pilot-title">
          <div className={styles.pilotBandInner}>
            <h2 id="pilot-title" className={styles.pilotBandTitle}>
              Pilot notice
            </h2>
            <p className={styles.pilotBandText}>
              This is an invited demo. Everything inside it (products, brands,
              concerns and responses) is an illustrative example using sample or
              redacted information. Nothing in the pilot describes a real
              complaint about a real company.
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container site-footer-inner">
          <span className="wordmark">
            <strong>Food</strong>Proof
          </span>
          <div>
            <p>
              FoodProof is an independent project, not affiliated with any
              government agency.
            </p>
            <p className="muted">
              Built for the celiac community in India. If you were invited to
              the pilot, reply through the same channel your invitation arrived
              on; there is no public contact address for this phase.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
