import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Toast, WhenPipe } from '../core';
import { AjustesNav } from './ajustes-nav';
import { IgCarousel } from './ig-carousel';

const POST_LINK = /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/;

/** Ajustes de la página pública: contacto, sobre nosotros, publicaciones de Instagram y opiniones. */
@Component({
  selector: 'app-pagina',
  imports: [FormsModule, WhenPipe, AjustesNav, IgCarousel],
  template: `
    <main class="page">
      <div class="row between">
        <h1>Ajustes</h1>
        <a class="btn chico" [href]="origin" target="_blank" rel="noopener">Ver la página pública</a>
      </div>
      <app-ajustes-nav />

      <div class="split">
        <div class="main col" style="gap: 20px">
          <section class="card col">
            <h2>Contacto</h2>
            <p class="chico suave">Las secciones sin datos no se muestran en la página.</p>
            <div class="grid">
              <div><label for="pg-wa">WhatsApp del negocio</label><input id="pg-wa" class="campo" type="tel" inputmode="numeric" placeholder="3001234567" [(ngModel)]="whatsapp" /></div>
              <div><label for="pg-ig">Usuario de Instagram</label><input id="pg-ig" class="campo" placeholder="columbiashine" autocapitalize="none" [(ngModel)]="instagram" /></div>
              <div><label for="pg-dir">Dirección</label><input id="pg-dir" class="campo" placeholder="Calle 00 # 00-00, barrio" [(ngModel)]="address" /></div>
              <div><label for="pg-map">Enlace de Google Maps (opcional)</label><input id="pg-map" class="campo" placeholder="https://maps.app.goo.gl/…" [(ngModel)]="maps" /></div>
              <div><label for="pg-gr">Enlace para calificar en Google (opcional)</label><input id="pg-gr" class="campo" placeholder="https://g.page/r/…" [(ngModel)]="google" /></div>
            </div>
          </section>

          <section class="card col">
            <h2>Sobre nosotros</h2>
            <textarea class="campo" rows="4" aria-label="Sobre nosotros" placeholder="Si lo dejas vacío sale un texto por defecto." [(ngModel)]="about"></textarea>
          </section>

          <section class="card col">
            <div class="row between">
              <h2>Publicaciones de Instagram</h2>
              <span class="chico suave">{{ posts().length }} de 12</span>
            </div>
            <p class="chico suave">En Instagram abre la publicación o el reel, toca "…" y "Copiar enlace". Deben ser de una cuenta pública. Se muestran en este orden, en un carrusel.</p>
            <div class="row">
              <input class="campo grow" style="flex-basis: 280px" placeholder="https://www.instagram.com/p/…" aria-label="Enlace de la publicación" [(ngModel)]="newPost" (keydown.enter)="addPost()" />
              <button class="btn primario" [disabled]="posts().length >= 12" (click)="addPost()">Agregar</button>
            </div>
            <div class="publicaciones">
              @for (p of posts(); track p; let i = $index, last = $last) {
                <div class="publicacion">
                  <span class="numero">{{ i + 1 }}</span>
                  <div class="grow enlace">
                    <div class="fuerte">{{ kind(p) }}</div>
                    <a class="chico" [href]="p" target="_blank" rel="noopener">{{ shortLink(p) }}</a>
                  </div>
                  <button class="btn chico" [disabled]="i === 0" (click)="movePost(i, -1)" aria-label="Subir">↑</button>
                  <button class="btn chico" [disabled]="last" (click)="movePost(i, 1)" aria-label="Bajar">↓</button>
                  <button class="btn chico" (click)="removePost(i)">Quitar</button>
                </div>
              } @empty {
                <p class="vacio">Todavía no hay publicaciones. Agrega tus mejores trabajos: los antes y después funcionan muy bien.</p>
              }
            </div>
            @if (posts().length) {
              <button class="btn chico" style="align-self: flex-start" (click)="preview.set(!preview())">{{ preview() ? 'Ocultar vista previa' : 'Ver cómo se verá' }}</button>
              @if (preview()) { <app-ig-carousel [posts]="posts()" /> }
            }
          </section>

          <button class="btn primario grande" style="align-self: flex-start" [disabled]="busy()" (click)="save()">Guardar cambios</button>
        </div>

        <section class="card side col" style="flex-basis: 420px">
          <h2>Opiniones</h2>
          <div class="row" style="gap: 6px">
            @for (f of filters; track f.id) {
              <button class="pastilla" [attr.aria-pressed]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }} ({{ count(f.id) }})</button>
            }
          </div>
          @for (r of shown(); track r.id) {
            <div class="tile col" style="gap: 6px">
              <div class="row between">
                <span><span class="amarillo">{{ '★'.repeat(r.rating) }}</span><span class="suave">{{ '☆'.repeat(5 - r.rating) }}</span> <span class="fuerte">{{ r.name }}</span></span>
                <span class="chico suave">{{ r.created_at | cuando: 'fecha' }}</span>
              </div>
              <div>{{ r.comment }}</div>
              <div class="row">
                @if (r.status !== 'PUBLICADA') { <button class="btn chico primario" (click)="setReview(r, 'PUBLICADA')">Publicar</button> }
                @if (r.status !== 'OCULTA') { <button class="btn chico" (click)="setReview(r, 'OCULTA')">Ocultar</button> }
              </div>
            </div>
          } @empty {
            <p class="chico suave">{{ filter() === 'PENDIENTE' ? 'No hay opiniones por revisar.' : 'No hay opiniones aquí.' }}</p>
          }
          <p class="chico suave">Comparte el enlace de la página con tus clientes para que te califiquen. Solo se publica lo que tú apruebas.</p>
        </section>
      </div>
    </main>
  `,
  styles: `
    .publicaciones { display: flex; flex-direction: column; gap: 8px; }
    .publicacion { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--gris-oscuro); }
    .numero { width: 32px; height: 32px; border-radius: 50%; background: var(--azul-oscuro); display: flex; align-items: center; justify-content: center; font-weight: 800; flex: 0 0 auto; }
    .enlace { min-width: 0; }
    .enlace a { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class Pagina {
  private api = inject(Api);
  private toast = inject(Toast);

  protected origin = location.origin + '/';
  protected whatsapp = signal('');
  protected instagram = signal('');
  protected address = signal('');
  protected maps = signal('');
  protected google = signal('');
  protected about = signal('');
  protected posts = signal<string[]>([]);
  protected newPost = signal('');
  protected preview = signal(false);
  protected busy = signal(false);
  protected reviews = signal<any[]>([]);
  protected filters = [
    { id: 'PENDIENTE', label: 'Por revisar' },
    { id: 'PUBLICADA', label: 'Publicadas' },
    { id: 'OCULTA', label: 'Ocultas' },
  ];
  protected filter = signal('PENDIENTE');
  protected shown = computed(() => this.reviews().filter((r) => r.status === this.filter()));
  count = (status: string) => this.reviews().filter((r) => r.status === status).length;

  constructor() {
    this.load();
  }

  private load() {
    this.api.get('/site-admin').then((d) => {
      const s = d.site;
      this.whatsapp.set(s.whatsapp);
      this.instagram.set(s.instagram);
      this.address.set(s.address);
      this.maps.set(s.mapsUrl);
      this.google.set(s.googleReviewsUrl);
      this.about.set(s.about);
      this.posts.set(s.instagramPosts ?? []);
      this.reviews.set(d.reviews);
    }, this.toast.fail);
  }

  kind = (p: string) => (p.includes('/reel/') ? 'Reel' : 'Publicación');
  shortLink = (p: string) => p.replace(/^https:\/\/(www\.)?/, '').replace(/\?.*$/, '');

  addPost() {
    const link = this.newPost().trim().replace(/\?.*$/, '');
    if (!POST_LINK.test(link)) return this.toast.show('Ese enlace no es de una publicación o reel de Instagram.', true);
    if (this.posts().includes(link)) return this.toast.show('Esa publicación ya está.', true);
    this.posts.update((p) => [...p, link].slice(0, 12));
    this.newPost.set('');
  }

  movePost(i: number, dir: number) {
    this.posts.update((p) => {
      const next = [...p];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  }

  removePost(i: number) {
    this.posts.update((p) => p.filter((_, j) => j !== i));
  }

  async save() {
    this.busy.set(true);
    try {
      await this.api.put('/site-admin', {
        whatsapp: this.whatsapp(), instagram: this.instagram(), address: this.address(), mapsUrl: this.maps(),
        googleReviewsUrl: this.google(), about: this.about(), instagramPosts: this.posts(),
      });
      this.toast.show('Página guardada.');
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  async setReview(r: any, status: string) {
    try {
      await this.api.patch('/reviews/' + r.id, { status });
      this.reviews.update((list) => list.map((x) => (x.id === r.id ? { ...x, status } : x)));
      this.toast.show(status === 'PUBLICADA' ? 'Opinión publicada.' : 'Opinión oculta.');
    } catch (e) {
      this.toast.fail(e);
    }
  }
}
