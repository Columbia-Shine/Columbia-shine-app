import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, shrinkPhoto, Toast, WhenPipe } from '../core';
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
            <p class="chico suave">En Instagram abre la publicación o el reel, toca "…" y "Copiar enlace". Deben ser de una cuenta pública. Se muestran en este orden, en un carrusel. Se publican apenas las agregas (no necesitas "Guardar cambios").</p>
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

          <section class="card col">
            <div class="row between">
              <h2>Promociones</h2>
              <button class="btn chico" [disabled]="promos().length >= 6" (click)="addPromo()">+ Agregar promoción</button>
            </div>
            <p class="chico suave">Salen debajo de la portada. Si les pones fecha, se ocultan solas cuando vencen.</p>
            @for (p of promos(); track $index; let i = $index) {
              <div class="tile col" style="gap: 8px">
                <div class="grid">
                  <div><label [for]="'pr-t' + i">Título</label><input [id]="'pr-t' + i" class="campo" placeholder="Ej.: Martes de Basic a $13.000" [ngModel]="p.title" (ngModelChange)="setPromo(i, 'title', $event)" /></div>
                  <div><label [for]="'pr-f' + i">Hasta (opcional)</label><input [id]="'pr-f' + i" class="campo" type="date" [ngModel]="p.until" (ngModelChange)="setPromo(i, 'until', $event)" /></div>
                </div>
                <div><label [for]="'pr-x' + i">Detalle (opcional)</label><input [id]="'pr-x' + i" class="campo" placeholder="Ej.: Solo los martes, agendando en línea." [ngModel]="p.text" (ngModelChange)="setPromo(i, 'text', $event)" /></div>
                <button class="btn chico" style="align-self: flex-start" (click)="removePromo(i)">Quitar</button>
              </div>
            } @empty {
              <p class="chico suave">No hay promociones activas.</p>
            }
          </section>

          <section class="card col">
            <h2>Empresas y domiciliarios</h2>
            <label class="interruptor"><input type="checkbox" [checked]="businessShow()" (change)="businessShow.set(!businessShow())" /> <span>Mostrar la sección "¿Tienes varias motos trabajando?"</span></label>
            @if (businessShow()) {
              <textarea class="campo" rows="3" aria-label="Texto para empresas" placeholder="Si lo dejas vacío sale un texto por defecto sobre planes para flotas." [(ngModel)]="businessText"></textarea>
            }
          </section>

          <button class="btn primario grande" style="align-self: flex-start" [disabled]="busy()" (click)="save()">Guardar cambios</button>

          <section class="card col">
            <h2>Fotos de la página</h2>
            <p class="chico suave">Las fotos se guardan al subirlas (no necesitas "Guardar cambios"). Se reducen solas para que la página cargue rápido.</p>

            <p class="rotulo">Foto de portada</p>
            <div class="row" style="align-items: center">
              @if (cover(); as c) { <img class="mini" [src]="c.url" alt="Foto de portada actual" /> } @else { <span class="chico suave">Sin foto: se muestra el logo.</span> }
              <label class="btn chico" for="up-portada">{{ cover() ? 'Cambiar foto' : 'Subir foto' }}</label>
              <input id="up-portada" type="file" accept="image/*" hidden (change)="upload('PORTADA', $event)" />
              @if (cover(); as c) { <button class="btn chico" (click)="removeImage(c)">Quitar</button> }
            </div>

            <p class="rotulo" style="margin-top: 12px">Antes y después</p>
            <div class="tile col" style="gap: 8px">
              <div class="row">
                <div class="grow"><label for="ad-antes">Foto del antes</label><input id="ad-antes" class="campo" type="file" accept="image/*" (change)="pick('before', $event)" /></div>
                <div class="grow"><label for="ad-despues">Foto del después</label><input id="ad-despues" class="campo" type="file" accept="image/*" (change)="pick('after', $event)" /></div>
              </div>
              <div class="grid">
                <div><label for="ad-t">Título (opcional)</label><input id="ad-t" class="campo" placeholder="Ej.: Pulsar NS 200" [(ngModel)]="pairTitle" /></div>
                <div><label for="ad-c">Detalle (opcional)</label><input id="ad-c" class="campo" placeholder="Ej.: Shine Detail + motor" [(ngModel)]="pairCaption" /></div>
              </div>
              <button class="btn chico primario" style="align-self: flex-start" [disabled]="busy() || !pairBefore() || !pairAfter()" (click)="uploadPair()">Subir antes y después</button>
            </div>
            <div class="fotos-lista">
              @for (i of pairs(); track i.id) {
                <div class="foto-item">
                  <div class="row" style="gap: 4px"><img class="mini" [src]="i.before" alt="Antes" /><img class="mini" [src]="i.url" alt="Después" /></div>
                  <span class="chico">{{ i.title || 'Sin título' }}</span>
                  <button class="btn chico" (click)="removeImage(i)">Quitar</button>
                </div>
              }
            </div>

            <p class="rotulo" style="margin-top: 12px">Nuestro equipo</p>
            <div class="tile col" style="gap: 8px">
              <div class="grid">
                <div><label for="eq-n">Nombre</label><input id="eq-n" class="campo" placeholder="Ej.: Gregorio" [(ngModel)]="teamName" /></div>
                <div><label for="eq-r">Qué hace (opcional)</label><input id="eq-r" class="campo" placeholder="Ej.: Detailing y motores" [(ngModel)]="teamRole" /></div>
              </div>
              <label class="btn chico" style="align-self: flex-start" for="up-equipo">Subir foto de la persona</label>
              <input id="up-equipo" type="file" accept="image/*" hidden (change)="upload('EQUIPO', $event)" />
            </div>
            <div class="fotos-lista">
              @for (i of teamImgs(); track i.id) {
                <div class="foto-item">
                  <img class="mini" [src]="i.url" [alt]="i.title || 'Equipo'" />
                  <span class="chico"><strong>{{ i.title }}</strong> {{ i.caption }}</span>
                  <button class="btn chico" (click)="removeImage(i)">Quitar</button>
                </div>
              }
            </div>
          </section>
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
    .mini { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; }
    .fotos-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
    .foto-item { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 12px; background: var(--gris-oscuro); }
    .interruptor { display: flex; align-items: center; gap: 12px; min-height: 44px; margin: 0; font-size: 15px; color: #fff; cursor: pointer; }
    .interruptor input { width: 22px; height: 22px; accent-color: var(--amarillo); }
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
  protected promos = signal<{ title: string; text: string; until: string }[]>([]);
  protected businessShow = signal(true);
  protected businessText = signal('');
  protected imgs = signal<any[]>([]);
  protected cover = computed(() => this.imgs().find((i) => i.kind === 'PORTADA') ?? null);
  protected pairs = computed(() => this.imgs().filter((i) => i.kind === 'ANTES_DESPUES'));
  protected teamImgs = computed(() => this.imgs().filter((i) => i.kind === 'EQUIPO'));
  protected pairBefore = signal<string | null>(null);
  protected pairAfter = signal<string | null>(null);
  protected pairTitle = signal('');
  protected pairCaption = signal('');
  protected teamName = signal('');
  protected teamRole = signal('');
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
      this.promos.set(s.promos ?? []);
      this.businessShow.set(s.business?.show !== false);
      this.businessText.set(s.business?.text ?? '');
      this.imgs.set(d.images ?? []);
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
    this.save('Publicación agregada a la página.');
  }

  movePost(i: number, dir: number) {
    this.posts.update((p) => {
      const next = [...p];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
    this.save('Orden guardado.');
  }

  removePost(i: number) {
    this.posts.update((p) => p.filter((_, j) => j !== i));
    this.save('Publicación quitada de la página.');
  }

  /** Guarda todo el contenido; las publicaciones de Instagram lo llaman solas al agregar, mover o quitar. */
  async save(done = 'Página guardada.') {
    this.busy.set(true);
    try {
      await this.api.put('/site-admin', {
        whatsapp: this.whatsapp(), instagram: this.instagram(), address: this.address(), mapsUrl: this.maps(),
        googleReviewsUrl: this.google(), about: this.about(), instagramPosts: this.posts(),
        promos: this.promos(), business: { show: this.businessShow(), text: this.businessText() },
      });
      this.toast.show(done);
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  // ---- Promociones ----
  addPromo() {
    this.promos.update((p) => [...p, { title: '', text: '', until: '' }]);
  }

  setPromo(i: number, key: 'title' | 'text' | 'until', value: string) {
    this.promos.update((p) => p.map((x, j) => (j === i ? { ...x, [key]: value ?? '' } : x)));
  }

  removePromo(i: number) {
    this.promos.update((p) => p.filter((_, j) => j !== i));
  }

  // ---- Fotos ----
  private async read(event: Event): Promise<string | null> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return null;
    try {
      return await shrinkPhoto(file, 1600);
    } catch {
      this.toast.show('No se pudo leer esa foto. Prueba con otra.', true);
      return null;
    }
  }

  async pick(which: 'before' | 'after', event: Event) {
    const data = await this.read(event);
    (which === 'before' ? this.pairBefore : this.pairAfter).set(data);
  }

  private async send(body: Record<string, unknown>, done: string) {
    this.busy.set(true);
    try {
      await this.api.post('/site-images', body);
      this.toast.show(done);
      this.imgs.set((await this.api.get('/site-admin')).images);
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  async upload(kind: 'PORTADA' | 'EQUIPO', event: Event) {
    const image = await this.read(event);
    (event.target as HTMLInputElement).value = '';
    if (!image) return;
    if (kind === 'EQUIPO' && !this.teamName().trim()) return this.toast.show('Escribe primero el nombre de la persona.', true);
    await this.send(
      kind === 'EQUIPO' ? { kind, image, title: this.teamName(), caption: this.teamRole() } : { kind, image },
      kind === 'EQUIPO' ? 'Foto del equipo subida.' : 'Foto de portada actualizada.',
    );
    if (kind === 'EQUIPO') {
      this.teamName.set('');
      this.teamRole.set('');
    }
  }

  async uploadPair() {
    await this.send(
      { kind: 'ANTES_DESPUES', before: this.pairBefore(), image: this.pairAfter(), title: this.pairTitle(), caption: this.pairCaption() },
      'Antes y después subido.',
    );
    this.pairBefore.set(null);
    this.pairAfter.set(null);
    this.pairTitle.set('');
    this.pairCaption.set('');
    for (const id of ['ad-antes', 'ad-despues']) (document.getElementById(id) as HTMLInputElement).value = '';
  }

  async removeImage(i: any) {
    try {
      await this.api.del('/site-images/' + i.id);
      this.imgs.update((list) => list.filter((x) => x.id !== i.id));
      this.toast.show('Foto quitada.');
    } catch (e) {
      this.toast.fail(e);
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
