import React, { useEffect, useState, useRef } from "react";
export function Stats() {
  const [days, setDays] = useState(30),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let stopped = false;
    setData(null);
    setError("");
    fetch("/api/admin/stats?days=" + days)
      .then(async (r) => {
        const b: any = await r.json();
        if (!r.ok) throw Error(b.error || "Unable to load stats");
        if (!stopped) setData(b);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [days, refresh]);
  const [selected, setSelected] = useState<{
    metric: string;
    label: string;
    value: string;
  } | null>(null);
  const [detail, setDetail] = useState<any>(null),
    [detailError, setDetailError] = useState(""),
    [offset, setOffset] = useState(0),
    [detailRefresh, setDetailRefresh] = useState(0);
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!selected) return;
    modal.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      modal.current?.close();
      document.body.style.overflow = previous;
    };
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    fetch(`/api/admin/stats/${selected.metric}?days=${days}&offset=${offset}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const b: any = await r.json();
        if (!r.ok) throw Error(b.error || "Unable to load details");
        if (!controller.signal.aborted) setDetail(b);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setDetailError(e.message);
      });
    return () => controller.abort();
  }, [selected, days, offset, detailRefresh]);
  const n = (v: any) => Number(v || 0).toLocaleString();
  return (
    <section className="panel stats">
      <h1>App stats</h1>
      <div className="stats-controls">
        <label>
          Period{" "}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={0}>All time</option>
          </select>
        </label>
        <button onClick={() => setRefresh((x) => x + 1)}>Refresh</button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading stats…</p>
      ) : (
        <>
          <div className="stats-grid">
            {[
              ["Page views", data.traffic.views],
              ["Unique browsers", data.traffic.visitors],
              ["Google accounts", data.users.accounts],
              ["Memes created", data.images.completed],
              ["Images retained", data.images.retained],
              ["Generation attempts", data.images.attempts],
              ["Failed generations", data.images.failed],
              ["Active generations", data.images.active],
              ["Credit packs purchased", data.purchases.packs],
              ["Credits purchased", data.purchases.credits],
              [
                "Purchase amount",
                "$" + (data.purchases.grossCents / 100).toFixed(2),
              ],
              ["Purchases needing review", data.review.purchases],
              [
                "Trial credits used",
                data.usage.find((x: any) => x.pool === "trial")?.used,
              ],
              [
                "Paid credits used",
                data.usage.find((x: any) => x.pool === "paid")?.used,
              ],
              ["Published shares", data.shares.published],
            ].map(([label, value], index) => (
              <button
                type="button"
                className="stats-card"
                key={label}
                aria-haspopup="dialog"
                onClick={() => {
                  setOffset(0);
                  setSelected({
                    metric: [
                      "views",
                      "visitors",
                      "accounts",
                      "completed",
                      "retained",
                      "attempts",
                      "failed",
                      "active",
                      "packs",
                      "credits",
                      "amount",
                      "review",
                      "trial",
                      "paid",
                      "shares",
                    ][index],
                    label: String(label),
                    value: typeof value === "string" ? value : n(value),
                  });
                }}
              >
                <span>{label}</span>
                <strong>{typeof value === "string" ? value : n(value)}</strong>
              </button>
            ))}
          </div>
          <p className="stats-note">
            Google accounts counts accounts created in this period. Memes
            created includes deleted images. Purchase amount covers paid packs,
            excludes purchases marked for refund/dispute review, and is not net
            revenue. Traffic tracking starts with this release; unique browsers
            cover at most 90 days and may include bots. Cookies and multiple
            devices affect these estimates. Daily groups use UTC; detail times
            use Eastern Time. Activity periods are rolling.
          </p>
          <h2>Daily activity</h2>
          <p>Most recent 30 days with activity in the selected period.</p>
          <div className="stats-table">
            <table>
              <thead>
                <tr>
                  <th>Date (UTC)</th>
                  <th>Page views</th>
                  <th>Memes</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...new Set<string>([
                    ...data.trafficDaily.map((x: any) => x.day),
                    ...data.daily.map((x: any) => x.day),
                  ]),
                ]
                  .sort()
                  .reverse()
                  .slice(0, 30)
                  .map((day) => (
                    <tr key={day}>
                      <td>{day}</td>
                      <td>
                        {n(
                          data.trafficDaily.find((x: any) => x.day === day)
                            ?.views,
                        )}
                      </td>
                      <td>
                        {n(data.daily.find((x: any) => x.day === day)?.images)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!data.daily.length && !data.trafficDaily.length && (
            <p>No activity recorded for this period.</p>
          )}
          <p className="stats-note">
            Updated{" "}
            {new Date(data.generatedAt * 1000).toLocaleString("en-US", {
              timeZone: "America/New_York",
              timeZoneName: "short",
            })}
          </p>
        </>
      )}
      <dialog
        ref={modal}
        className="stats-modal"
        aria-labelledby="stats-detail-title"
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === modal.current) {
            const r = modal.current.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              setSelected(null);
          }
        }}
      >
        <button
          type="button"
          className="close"
          aria-label="Close stat details"
          onClick={() => setSelected(null)}
        >
          ×
        </button>
        <h2 id="stats-detail-title">{selected?.label}</h2>
        <p>
          {selected?.value} · {days ? `Last ${days} days` : "All time"}
        </p>
        {detailError ? (
          <div role="alert">
            <p>{detailError}</p>
            <button onClick={() => setDetailRefresh((x) => x + 1)}>
              Retry
            </button>
          </div>
        ) : !detail ? (
          <p role="status">Loading details…</p>
        ) : (
          <>
            {detail.note && <p className="stats-note">{detail.note}</p>}
            {detail.rows.length ? (
              <div
                className="stats-table"
                tabIndex={0}
                aria-label="Stat detail records"
              >
                <table>
                  <thead>
                    <tr>
                      {detail.columns.map((col: string) => (
                        <th key={col} scope="col">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((row: any, index: number) => (
                      <tr key={index}>
                        {detail.columns.map((col: string) => (
                          <td key={col}>
                            {col === "Provider details" && row[col] ? (
                              <pre
                                style={{
                                  whiteSpace: "pre-wrap",
                                  overflowWrap: "anywhere",
                                  minWidth: 240,
                                  maxWidth: 480,
                                }}
                              >
                                {JSON.stringify(JSON.parse(row[col]), null, 2)}
                              </pre>
                            ) : row[col] == null ? (
                              "—"
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No records in this period.</p>
            )}
            <div className="stats-pagination">
              <button
                disabled={offset === 0}
                onClick={() => setOffset((x) => Math.max(0, x - 50))}
              >
                Previous
              </button>
              <span>
                {detail.rows.length
                  ? `Rows ${offset + 1}–${offset + detail.rows.length}`
                  : "0 rows"}
              </span>
              <button
                disabled={detail.nextOffset === null}
                onClick={() => setOffset(detail.nextOffset)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
