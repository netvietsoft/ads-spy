'use client';
import { useEffect, useState } from 'react';
import { Favorite, addFavorite, listFavorites, removeFavorite } from '../api';

export function Favorites({
  source,
  country,
  currentQuery,
  onReplay,
  onFresh,
}: {
  source: 'google' | 'facebook';
  country?: string;
  currentQuery?: string;
  onReplay: (fav: Favorite) => void; // xem lại từ DB
  onFresh: (fav: Favorite) => void; // tìm mới (live)
}) {
  const [list, setList] = useState<Favorite[]>([]);
  const [input, setInput] = useState('');

  const reload = () => listFavorites(source).then(setList).catch(() => {});
  useEffect(() => {
    reload();
  }, [source]);

  async function add(q: string) {
    const v = q.trim();
    if (!v) return;
    await addFavorite(source, v, source === 'facebook' ? country : undefined);
    setInput('');
    reload();
  }

  async function del(id: number) {
    await removeFavorite(id);
    reload();
  }

  return (
    <div className="favs">
      <div className="favs-head">
        <h3>⭐ Đối thủ theo dõi {source === 'facebook' ? '(Facebook)' : '(Google)'}</h3>
      </div>
      <form
        className="favs-add"
        onSubmit={(e) => {
          e.preventDefault();
          add(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            source === 'google'
              ? 'Thêm domain đối thủ (vd: nike.com)'
              : 'Thêm Page/từ khóa đối thủ (link, @handle, từ khóa)'
          }
        />
        <button className="ghost" type="submit">
          ＋ Lưu
        </button>
        {currentQuery && currentQuery.trim() && (
          <button className="ghost" type="button" onClick={() => add(currentQuery)} title="Lưu từ khóa đang tra">
            ★ Lưu mục đang xem
          </button>
        )}
      </form>

      {list.length === 0 ? (
        <p className="hint">Chưa có đối thủ nào. Thêm ở trên để theo dõi quảng cáo của họ.</p>
      ) : (
        <div className="favs-list">
          {list.map((f) => (
            <div className="fav" key={f.id}>
              <span className="fav-name" title={f.query}>
                {f.label || f.query}
                {f.country ? <span className="m"> · {f.country}</span> : null}
              </span>
              <span className="fav-btns">
                <button className="ghost" onClick={() => onReplay(f)} title="Xem lại kết quả đã lưu (nhanh)">
                  🕘 Xem lại
                </button>
                <button className="ghost" onClick={() => onFresh(f)} title="Tìm mới để xem quảng cáo mới nhất">
                  🔄 Tìm mới
                </button>
                <button className="ghost danger" onClick={() => del(f.id)} title="Xoá">
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
