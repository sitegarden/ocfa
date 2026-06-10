export default function Home() {
  return (
    <main className="page">
      <section className="page-head">
        <p className="eyebrow">Original Character Fan Art</p>
        <h1>描いて、参加して、うちの子を広げる。</h1>
        <p>
          OCFA v2は、サイト内でキャラを描いて登録し、
          イベントを通してファンアートを描き合えるOC専用サイトです。
        </p>
      </section>

      <section className="home-cards">
        <article className="form-panel">
          <h2>キャラを描いて登録</h2>
          <p>画像URLは使わず、その場で描いたイラストを登録できます。</p>
        </article>

        <article className="form-panel">
          <h2>イベントで描き合う</h2>
          <p>自由すぎる投稿ではなく、イベントごとのルールで参加できます。</p>
        </article>

        <article className="form-panel">
          <h2>ゆるく交流</h2>
          <p>いいねと短文コメント中心で、重くなりすぎない場所を目指します。</p>
        </article>
      </section>
    </main>
  );
}
