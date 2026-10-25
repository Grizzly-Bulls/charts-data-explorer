import { getCatalog, getObservations } from '../src/charts-api.mjs';

// Deliberate operator-only smoke. No credentials or mutations, and NEVER
// invoked by npm test / check / GitHub CI.
async function main() {
  const series = await getCatalog();
  if (!series.length) throw new Error('The public Charts API catalog has no approved series.');
  const item = series.find(s => s.slug === 'us-real-gdp') ?? series[0];
  const result = await getObservations(item.slug, { order: 'desc', limit: 5, offset: 0 });
  if (result.observations.length < 1) throw new Error('The sample series returned no observations.');
  console.log(JSON.stringify({
    status: 'pass',
    contract: 'keyless-public-charts-v1',
    approvedSeriesCount: series.length,
    sampleSlug: item.slug,
    sampleRows: result.observations.length,
    source: result.series.source.name,
    oldestReturnedPeriod: result.observations[result.observations.length - 1].date,
    newestReturnedPeriod: result.observations[0].date,
  }, null, 2));
}
main().catch(err => {
  console.error('Charts public API smoke failed: ' + (err instanceof Error ? err.message : 'unknown error'));
  process.exitCode = 1;
});
