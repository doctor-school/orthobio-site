/**
 * `.astro` module shape for `tsc --noEmit`.
 *
 * `pnpm typecheck` runs two checkers. `astro check` brings the Astro language
 * server, which resolves a `.astro` import natively; plain `tsc` does not and
 * reports TS2307 for the one unit test that renders a component through the
 * container API (`video-card.test.ts` — see the note there for why that test
 * exists at all).
 *
 * Typed as exactly what the container accepts rather than as `any`: the
 * component factory type has no public export of its own, so it is read off
 * `renderToString`'s own signature. A file that is not a valid component still
 * fails to compile, which is the point of declaring it at all.
 */
declare module '*.astro' {
  type Container = Awaited<
    ReturnType<typeof import('astro/container').experimental_AstroContainer.create>
  >;
  const Component: Parameters<Container['renderToString']>[0];
  export default Component;
}
