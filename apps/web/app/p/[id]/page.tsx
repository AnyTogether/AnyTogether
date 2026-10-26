import { PostCard } from "@/components/Captures";
import { strings, ui } from "@/lib/i18n";
import type { Post } from "@/lib/posts";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ id: string }> };
const isId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** A post's page never previews its contents: who may see it is the server's call, per reader. */
export async function generateMetadata(): Promise<Metadata> {
  const texts = await strings();
  return { title: `${texts.captures} · AnyTogether`, robots: { index: false, follow: false } };
}

/** One capture with its comments open below it (where notifications lead). */
export default async function PostPage({ params }: Params) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=/p/${id}`);
  const post = await apiJson<Post>(`/posts/${id}`);
  return (
    <section className="page captures post-page">
      <nav className="crumbs in d1">
        <Link href="/captures">{texts.captures}</Link>
        {post.body && (
          <>
            <span aria-hidden="true"> / </span>
            <Link href={`/u/${post.body.author.handle}`}>@{post.body.author.handle}</Link>
          </>
        )}
      </nav>
      <div className="in d2">
        {post.body ? (
          <PostCard post={post.body} texts={ui(texts)} now={Date.now()} inline />
        ) : (
          <div className="card feed-empty cap-empty">
            <p className="empty">{texts.capNotFound}</p>
            <Link href="/captures" className="pill">
              {texts.captures}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
