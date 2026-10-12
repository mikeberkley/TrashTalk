import React, { useEffect, useState } from "react";
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
            ].map(([label, value]) => (
              <div className="stats-card" key={label}>
                <span>{label}</span>
                <strong>{typeof value === "string" ? value : n(value)}</strong>
              </div>
            ))}
          </div>
          <p className="stats-note">
            Google accounts counts accounts created in this period. Memes
            created includes deleted images. Purchase amount covers paid packs,
            excludes purchases marked for refund/dispute review, and is not net
            revenue. Traffic tracking starts with this release; unique browsers
            cover at most 90 days and may include bots. Cookies and multiple
            devices affect these estimates. Dates use UTC; activity periods are
            rolling.
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
            Updated {new Date(data.generatedAt * 1000).toLocaleString()}
          </p>
        </>
      )}
    </section>
  );
}
