import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { Api, homeFor, MoneyPipe, Session, Toast } from '../core';
import { AntesDespues, Aparecer } from './antes-despues';
import { IgCarousel } from './ig-carousel';


const HOURS = [
  { days: 'Lunes a viernes', hours: '10:00 a. m. – 7:30 p. m.' },
  { days: 'Sábados y domingos', hours: '9:00 a. m. – 5:30 p. m.' },
];

const FAQ = [
  { q: '¿Tengo que agendar o puedo llegar?', a: 'Puedes llegar sin cita y te atendemos por orden de llegada. Si agendas, tu cupo queda separado y no esperas.' },
  { q: '¿Cuánto se demora el lavado?', a: 'Depende del servicio: desde 10 minutos el Express hasta unas 2 horas el Full. En cada servicio ves el tiempo aproximado.' },
  { q: '¿Cómo sé que mi moto está lista?', a: 'Te escribimos por WhatsApp apenas termina el lavado, para que vengas por ella sin esperar.' },
  { q: '¿Qué pasa si mi moto ya tiene rayones o golpes?', a: 'Al recibirla tomamos fotos y anotamos su estado, delante de ti. Así ambos sabemos cómo llegó.' },
  { q: '¿Cómo puedo pagar?', a: 'Efectivo, Nequi, Daviplata, transferencia o datáfono. Pagas al recoger tu moto y te enviamos el comprobante por WhatsApp.' },
  { q: '¿Qué productos usan?', a: 'Shampoo de pH neutro y productos pensados para cada superficie. Cuidamos conectores y zonas eléctricas en el lavado del motor.' },
];

/** Página pública: quiénes somos, servicios, precios, membresías, Instagram, opiniones y cómo llegar. */
@Component({
  selector: 'app-landing',
  imports: [FormsModule, RouterLink, MoneyPipe, IgCarousel, AntesDespues, Aparecer],
  template: `
    <div class="landing">
      <header class="nav">
        <a class="marca-nav" href="#inicio"><img src="logo-96.webp" alt="" width="44" height="42" /> <span>Columbia Shine</span></a>
        <nav aria-label="Secciones">
          <a href="#servicios">Servicios</a>
          @if (beforeAfter().length) { <a href="#resultados">Resultados</a> }
          @if (site()?.plans?.length) { <a href="#membresias">Membresías</a> }
          <a href="#opiniones">Opiniones</a>
          <a href="#ubicacion">Ubicación</a>
        </nav>
        <a class="btn primario chico" routerLink="/cliente">Agenda tu lavado</a>
      </header>

      <section id="inicio" class="hero">
        <div class="hero-texto">
          <p class="rotulo amarillo">Lavado y detailing de motos en Bogotá</p>
          <h1>Pasión por tu máquina.</h1>
          <p class="bajada">Dejamos tu moto brillando. Agenda en línea, te recibimos con fotos de su estado y te avisamos por WhatsApp apenas esté lista.</p>
          <div class="row">
            <a class="btn primario grande" routerLink="/cliente">Agenda tu lavado</a>
            @if (whatsapp(); as w) { <a class="btn grande" [href]="w" target="_blank" rel="noopener">Escríbenos por WhatsApp</a> }
          </div>
          <ul class="sellos">
            <li>Shampoo pH neutro</li>
            <li>Fotos al recibir tu moto</li>
            <li>Aviso por WhatsApp</li>
            <li>Paga con Nequi o efectivo</li>
          </ul>
        </div>
        @if (cover(); as c) {
          <div class="hero-foto"><img [src]="c.url" [alt]="c.title || 'Moto brillando en Columbia Shine'" width="560" height="420" /><img class="sello-logo" src="logo-96.webp" alt="" width="84" height="81" /></div>
        } @else {
          <div class="hero-logo"><img src="logo-480.webp" alt="Columbia Shine, pasión por tu máquina" width="380" height="366" fetchpriority="high" /></div>
        }
      </section>

      @if (site()?.promos?.length) {
        <section class="promos" aparecer aria-label="Promociones">
          @for (p of site().promos; track p.title) {
            <article class="promo">
              <span class="etiqueta amarilla">Promoción</span>
              <h3>{{ p.title }}</h3>
              @if (p.text) { <p>{{ p.text }}</p> }
              @if (p.until) { <span class="chico">Hasta el {{ dayName(p.until) }}</span> }
            </article>
          }
        </section>
      }

      @if (stats(); as st) {
        <section class="cifras">
          @if (st.bikes) { <div><strong>{{ thousands(st.bikes) }}+</strong><span>motos entregadas</span></div> }
          @if (st.customers) { <div><strong>{{ thousands(st.customers) }}+</strong><span>clientes</span></div> }
          @if (st.score) { <div><strong>{{ st.score }} / 5</strong><span>en {{ st.reviews }} opiniones</span></div> }
          <div><strong>7 días</strong><span>a la semana</span></div>
        </section>
      }

      <section id="servicios" class="seccion" aparecer>
        <p class="rotulo amarillo">Servicios</p>
        <h2>Elige el brillo que tu moto necesita</h2>
        <div class="tarjetas">
          @for (s of bases(); track s.id) {
            <article class="servicio" [class.destacado]="s.recommended">
              @if (s.recommended) { <span class="etiqueta amarilla">Recomendado</span> }
              <h3>{{ s.name }}</h3>
              <div class="precio">{{ s.price | money }}</div>
              <div class="chico suave">{{ s.focus }} · {{ s.min_minutes }}–{{ s.max_minutes }} min</div>
              @if (s.steps?.length) {
                <ul class="pasos">
                  @for (p of s.steps; track p) { <li>{{ p }}</li> }
                </ul>
              }
              <a class="btn bloque" [class.primario]="s.recommended" routerLink="/cliente">Agendar</a>
            </article>
          }
        </div>
      </section>

      @if (beforeAfter().length) {
        <section id="resultados" class="seccion alterna" aparecer>
          <p class="rotulo amarillo">Resultados</p>
          <h2>Antes y después</h2>
          <p class="suave">Arrastra la línea para ver la diferencia.</p>
          <div class="galeria">
            @for (i of beforeAfter(); track i.id) {
              <app-antes-despues [before]="i.before" [after]="i.url" [title]="i.title" [caption]="i.caption" />
            }
          </div>
        </section>
      }

      <section class="seccion" aparecer>
        <p class="rotulo amarillo">Así trabajamos</p>
        <h2>Simple, a tiempo y sin sorpresas</h2>
        <ol class="pasos-trabajo">
          <li><strong>Agenda o llega</strong><span>Separa tu hora en línea o ven directo.</span></li>
          <li><strong>Recibimos con fotos</strong><span>Revisamos tu moto contigo y registramos su estado.</span></li>
          <li><strong>La lavamos con cuidado</strong><span>Productos adecuados para cada superficie.</span></li>
          <li><strong>Te avisamos</strong><span>Recibes un WhatsApp cuando está lista y tu comprobante al pagar.</span></li>
        </ol>
      </section>

      @if (site()?.plans?.length) {
        <section id="membresias" class="seccion alterna" aparecer>
          <p class="rotulo amarillo">Membresías</p>
          <h2>Tu moto siempre impecable, por menos</h2>
          <p class="suave">Paga una vez y usa tus lavados durante 30 días.</p>
          <div class="tarjetas">
            @for (p of site().plans; track p.name) {
              <article class="servicio">
                <h3>{{ p.name }}</h3>
                <div class="precio">{{ p.price | money }}</div>
                <div class="chico suave">{{ p.washes }} × {{ p.service_name }} en 30 días</div>
                @if (saving(p) > 0) { <div class="ahorro">Ahorras {{ (p.washes * p.service_price - p.price) | money }}</div> }
                @if (whatsapp()) {
                  <a class="btn bloque" [href]="planLink(p)" target="_blank" rel="noopener">Quiero esta membresía</a>
                }
              </article>
            }
          </div>
          <p class="chico suave">La membresía es para una moto (placa). Pídela en el local o escríbenos.</p>
        </section>
      }


      @if (site()?.instagramPosts?.length || site()?.instagram) {
        <section class="seccion" aparecer>
          <div class="encabezado-seccion">
            <div>
              <p class="rotulo amarillo">Instagram</p>
              <h2>Así quedan las motos</h2>
            </div>
            @if (site()?.instagram) {
              <a class="ig-chip" [href]="'https://instagram.com/' + site().instagram" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.3" fill="currentColor"/></svg>
                <span>&#64;{{ site().instagram }}</span>
              </a>
            }
          </div>
          @if (site()?.instagramPosts?.length) {
            <app-ig-carousel [posts]="site().instagramPosts" />
          } @else {
            <p class="suave">Mira nuestros trabajos más recientes en Instagram.</p>
          }
        </section>
      }

      @if (site()?.business?.show) {
        <section class="seccion alterna" aparecer>
          <div class="empresas">
            <div class="col" style="gap: 12px">
              <p class="rotulo amarillo">Empresas y domiciliarios</p>
              <h2>¿Tienes varias motos trabajando?</h2>
              <p class="sobre">{{ site().business.text || defaultBusiness }}</p>
            </div>
            @if (businessLink(); as b) {
              <a class="btn primario grande" [href]="b" target="_blank" rel="noopener">Cotiza para tu flota</a>
            }
          </div>
        </section>
      }

      @if (team().length) {
        <section class="seccion" aparecer>
          <p class="rotulo amarillo">Nuestro equipo</p>
          <h2>Las manos detrás del brillo</h2>
          <div class="equipo">
            @for (t of team(); track t.id) {
              <figure class="persona"><img [src]="t.url" [alt]="t.title || 'Equipo de Columbia Shine'" loading="lazy" width="300" height="300" /><figcaption><strong>{{ t.title }}</strong>@if (t.caption) { <span>{{ t.caption }}</span> }</figcaption></figure>
            }
          </div>
        </section>
      }

      <section class="seccion alterna" aparecer>
        <div class="sobre-grid">
          <div class="col" style="gap: 12px">
            <p class="rotulo amarillo">Sobre nosotros</p>
            <h2>Somos Columbia Shine</h2>
            <p class="sobre">{{ site()?.about || defaultAbout }}</p>
          </div>
          <img src="logo-240.webp" alt="" width="220" height="212" loading="lazy" />
        </div>
      </section>

      <section id="ubicacion" class="seccion" aparecer>
        <p class="rotulo amarillo">Horario y ubicación</p>
        <h2>Te esperamos</h2>
        <div class="ubicacion">
          <div class="col" style="gap: 14px">
            @for (h of hours; track h.days) {
              <div class="row between horario"><span>{{ h.days }}</span><strong>{{ h.hours }}</strong></div>
            }
            @if (site()?.address) { <p><strong>Dirección:</strong> {{ site().address }}</p> }
            <div class="row">
              @if (mapLink(); as m) { <a class="btn" [href]="m" target="_blank" rel="noopener">Cómo llegar</a> }
              @if (whatsapp(); as w) { <a class="btn" [href]="w" target="_blank" rel="noopener">WhatsApp</a> }
              <a class="btn primario" routerLink="/cliente">Agenda tu lavado</a>
            </div>
          </div>
          @if (mapEmbed(); as m) {
            <iframe class="mapa" [src]="m" title="Mapa de Columbia Shine" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
          }
        </div>
      </section>

      <section class="seccion alterna" aparecer>
        <p class="rotulo amarillo">Preguntas frecuentes</p>
        <h2>Lo que más nos preguntan</h2>
        <div class="faq">
          @for (f of faq; track f.q) {
            <details><summary>{{ f.q }}</summary><p>{{ f.a }}</p></details>
          }
        </div>
      </section>

      <section id="opiniones" class="seccion" aparecer>
        <div class="encabezado-seccion">
          <div>
            <p class="rotulo amarillo">Opiniones</p>
            <h2>Lo que dicen nuestros clientes</h2>
          </div>
          @if (site()?.score?.n) {
            <div class="puntaje">
              <strong>{{ site().score.avg }}</strong>
              <div><div class="estrellas">{{ stars(round(site().score.avg)) }}</div><div class="chico suave">{{ site().score.n }} {{ site().score.n === 1 ? 'opinión' : 'opiniones' }}</div></div>
            </div>
          }
        </div>
        <div class="opiniones-grid">
          <div class="opiniones">
            @for (r of site()?.reviews ?? []; track r.id) {
              <figure class="opinion">
                <span class="comillas" aria-hidden="true">“</span>
                <blockquote>{{ r.comment }}</blockquote>
                <figcaption>
                  <span class="inicial" aria-hidden="true">{{ r.name.charAt(0) }}</span>
                  <span><strong>{{ r.name }}</strong><span class="estrellas chico">{{ stars(r.rating) }}</span></span>
                </figcaption>
              </figure>
            } @empty {
              <p class="suave">Sé de los primeros en contarnos cómo te fue.</p>
            }
          </div>
          <div class="dejar card col">
            @if (sent()) {
              <h3>¡Gracias por tu opinión!</h3>
              <p class="suave">La publicaremos después de revisarla.</p>
            } @else {
              <h3>Cuéntanos cómo te fue</h3>
              <div class="row" style="gap: 0" role="radiogroup" aria-label="Calificación">
                @for (n of [1, 2, 3, 4, 5]; track n) {
                  <button class="estrella" role="radio" [attr.aria-checked]="rating() === n" [attr.aria-label]="n + ' de 5'" [class.llena]="n <= rating()" (click)="rating.set(n)">★</button>
                }
              </div>
              <div><label for="op-nombre">Tu nombre</label><input id="op-nombre" class="campo" autocapitalize="words" maxlength="60" [(ngModel)]="name" /></div>
              <div><label for="op-texto">Tu comentario</label><textarea id="op-texto" class="campo" rows="3" maxlength="500" [(ngModel)]="comment"></textarea></div>
              <button class="btn primario" style="align-self: flex-start" [disabled]="busy()" (click)="sendReview()">Enviar opinión</button>
            }
            @if (site()?.googleReviewsUrl) {
              <a class="chico" [href]="site().googleReviewsUrl" target="_blank" rel="noopener">También puedes calificarnos en Google</a>
            }
          </div>
        </div>
      </section>

      <section class="cierre">
        <h2>¿Lista tu máquina para brillar?</h2>
        <a class="btn primario grande" routerLink="/cliente">Agenda tu lavado</a>
      </section>

      @if (whatsapp(); as w) {
        <a class="wa-flotante" [href]="w" target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z"/></svg></a>
      }
      <nav class="barra-movil" aria-label="Acciones rápidas">
        <a routerLink="/cliente" class="principal">Agendar</a>
        @if (whatsapp(); as w) { <a [href]="w" target="_blank" rel="noopener">WhatsApp</a> }
        @if (mapLink(); as m) { <a [href]="m" target="_blank" rel="noopener">Cómo llegar</a> }
      </nav>

      <footer class="pie">
        <div class="row" style="gap: 10px"><img src="logo-96.webp" alt="" width="36" height="35" /> <strong>Columbia Shine</strong> · Pasión por tu máquina.</div>
        <div class="row chico">
          @if (site()?.instagram) { <a [href]="'https://instagram.com/' + site().instagram" target="_blank" rel="noopener">Instagram</a> }
          @if (whatsapp(); as w) { <a [href]="w" target="_blank" rel="noopener">WhatsApp</a> }
          <a routerLink="/cliente">Mi cuenta</a>
          <a routerLink="/ingreso">Equipo</a>
        </div>
        <div class="chico suave">© {{ year }} Columbia Shine · Bogotá, Colombia</div>
      </footer>
    </div>
  `,
  styles: `

    .nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 16px; padding: 10px 20px; background: rgba(11, 15, 23, 0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--gris-oscuro); }
    .marca-nav { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: 800; font-style: italic; font-size: 18px; }
    .nav nav { display: flex; gap: 4px; flex: 1; justify-content: center; }
    .nav nav a { color: var(--texto-suave); padding: 12px 10px; font-weight: 600; }
    .nav nav a:hover { color: var(--amarillo); }
    @media (max-width: 760px) { .nav nav { display: none; } .marca-nav span { display: none; } .nav { justify-content: space-between; } }

    .landing { overflow-x: hidden; background: radial-gradient(900px 500px at 85% 0%, rgba(0, 71, 163, 0.35), transparent 60%), var(--fondo); }
    .hero { display: grid; grid-template-columns: 1.2fr 1fr; gap: 32px; align-items: center; max-width: 1180px; margin: 0 auto; padding: 56px 20px 40px; }
    .hero h1 { font-size: clamp(40px, 7vw, 72px); line-height: 1.02; margin: 8px 0 16px; }
    .bajada { font-size: 19px; color: var(--texto-suave); max-width: 560px; margin: 0 0 24px; }
    .hero-logo { display: flex; justify-content: center; }
    .hero-logo img { width: min(100%, 380px); height: auto; filter: drop-shadow(0 20px 60px rgba(0, 123, 255, 0.35)); }
    .sellos { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 24px 0 0; }
    .sellos li { padding: 8px 14px; border-radius: 999px; background: var(--gris-oscuro); font-size: 14px; font-weight: 600; }
    @media (max-width: 860px) { .hero { grid-template-columns: 1fr; padding-top: 28px; } .hero-logo { order: -1; } .hero-logo img { width: 220px; } }

    .hero-foto { position: relative; }
    .hero-foto img:first-child { width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 20px; box-shadow: 0 30px 60px rgba(0, 0, 0, 0.45); }
    .sello-logo { position: absolute; left: -18px; bottom: -18px; width: 84px; height: auto; filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.5)); }
    @media (max-width: 860px) { .hero-foto { order: -1; } .sello-logo { left: 10px; bottom: -14px; width: 64px; } }

    .promos { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; max-width: 1180px; margin: 0 auto; padding: 0 20px 24px; }
    .promo { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; border-radius: var(--radio); background: linear-gradient(135deg, rgba(255, 210, 0, 0.16), rgba(0, 71, 163, 0.3)); border: 1px solid rgba(255, 210, 0, 0.45); }
    .promo h3 { margin: 4px 0 0; font-size: 22px; font-style: italic; }
    .promo p { margin: 0; color: var(--texto-suave); }
    .promo .etiqueta { align-self: flex-start; }


    .galeria { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .empresas { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
    .equipo { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .persona { margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .persona img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radio); }
    .persona figcaption { display: flex; flex-direction: column; }
    .persona figcaption span { color: var(--texto-suave); }

    .wa-flotante { position: fixed; right: 20px; bottom: 20px; z-index: 20; width: 60px; height: 60px; border-radius: 50%; background: #25d366; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); transition: transform 0.15s; }
    .wa-flotante:hover { transform: scale(1.06); }
    .wa-flotante svg { width: 32px; height: 32px; }
    .barra-movil { display: none; }
    @media (max-width: 760px) {
      .wa-flotante { display: none; }
      .barra-movil { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); background: rgba(11, 15, 23, 0.96); border-top: 1px solid var(--gris-oscuro); backdrop-filter: blur(8px); }
      .barra-movil a { flex: 1; min-height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 12px; border: 1px solid var(--gris-medio); color: #fff; font-weight: 700; }
      .barra-movil a.principal { background: var(--amarillo); color: var(--negro); border-color: var(--amarillo); }
      .pie { padding-bottom: 96px; }
    }

    .cifras { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; max-width: 1180px; margin: 0 auto; padding: 0 20px 20px; }
    .cifras div { background: var(--azul-oscuro); border-radius: var(--radio); padding: 18px; display: flex; flex-direction: column; }
    .cifras strong { font-size: 30px; font-weight: 800; }
    .cifras span { color: #dbeafe; }

    .seccion { max-width: 1180px; margin: 0 auto; padding: 56px 20px; display: flex; flex-direction: column; gap: 12px; }
    .alterna { max-width: none; background: var(--panel); }
    .alterna > * { max-width: 1140px; width: 100%; margin-left: auto; margin-right: auto; }
    .seccion h2 { font-size: clamp(28px, 4vw, 40px); font-style: italic; font-weight: 800; margin-top: 0; margin-bottom: 12px; }

    .tarjetas { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .servicio { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 22px; border-radius: var(--radio); background: var(--panel); border: 1px solid var(--gris-oscuro); transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s; }
    .servicio:hover { transform: translateY(-3px); border-color: var(--azul); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35); }
    .servicio.destacado { border: 2px solid var(--amarillo); }
    .servicio .etiqueta { position: absolute; top: -12px; left: 18px; }
    .servicio h3 { margin: 6px 0 0; font-size: 22px; font-style: italic; }
    .precio { font-size: 34px; font-weight: 800; color: var(--amarillo); }
    .pasos { margin: 6px 0 10px; padding-left: 18px; color: var(--texto-suave); font-size: 14px; flex: 1; }
    .ahorro { color: var(--aqua); font-weight: 700; }

    .pasos-trabajo { list-style: none; counter-reset: paso; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 0; margin: 0; }
    .pasos-trabajo li { counter-increment: paso; display: flex; flex-direction: column; gap: 6px; padding: 20px; border-radius: var(--radio); background: var(--panel); border: 1px solid var(--gris-oscuro); }
    .pasos-trabajo li::before { content: counter(paso); width: 40px; height: 40px; border-radius: 50%; background: var(--amarillo); color: var(--negro); font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .pasos-trabajo span { color: var(--texto-suave); }

    .encabezado-seccion { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
    .encabezado-seccion h2 { margin-bottom: 0 !important; }
    .ig-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px 0 12px; border-radius: 999px; color: #fff; font-weight: 700; font-size: 14px;
      background: linear-gradient(var(--fondo), var(--fondo)) padding-box, linear-gradient(45deg, #f9ce34, #ee2a7b, #6228d7) border-box; border: 2px solid transparent; transition: transform 0.15s; }
    .ig-chip:hover { transform: translateY(-1px); }
    .ig-chip svg { color: #ee2a7b; }

    .puntaje { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-radius: 999px; background: var(--panel); }
    .puntaje strong { font-size: 36px; color: var(--amarillo); line-height: 1; }
    .opiniones-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 20px; align-items: start; }
    @media (max-width: 900px) { .opiniones-grid { grid-template-columns: 1fr; } }
    .estrellas { color: var(--amarillo); letter-spacing: 2px; }
    .opiniones { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .opinion { position: relative; margin: 0; padding: 22px 20px 18px; border-radius: var(--radio); background: var(--panel); border: 1px solid var(--gris-oscuro); display: flex; flex-direction: column; gap: 14px; }
    .comillas { position: absolute; top: -6px; right: 16px; font-size: 64px; line-height: 1; color: var(--azul); opacity: 0.5; font-family: Georgia, serif; }
    .opinion blockquote { margin: 0; font-size: 16px; line-height: 1.5; }
    .opinion figcaption { display: flex; align-items: center; gap: 10px; }
    .opinion figcaption > span:last-child { display: flex; flex-direction: column; }
    .inicial { width: 38px; height: 38px; border-radius: 50%; background: var(--azul-oscuro); color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; text-transform: uppercase; }
    .dejar { gap: 12px; }
    .estrella { width: 48px; height: 48px; font-size: 30px; border: 0; background: none; color: var(--gris-medio); cursor: pointer; }
    .estrella.llena { color: var(--amarillo); }

    .sobre { font-size: 18px; color: var(--texto-suave); max-width: 720px; white-space: pre-line; margin: 0; }
    .sobre-grid { display: grid; grid-template-columns: 1fr auto; gap: 32px; align-items: center; }
    .sobre-grid img { width: 220px; height: auto; opacity: 0.9; }
    @media (max-width: 760px) { .sobre-grid { grid-template-columns: 1fr; } .sobre-grid img { display: none; } }
    .ubicacion { display: grid; grid-template-columns: 1fr 1.2fr; gap: 24px; align-items: start; }
    .horario { padding: 12px 0; border-bottom: 1px solid var(--gris-oscuro); }
    .mapa { width: 100%; height: 320px; border: 0; border-radius: var(--radio); }
    @media (max-width: 860px) { .ubicacion { grid-template-columns: 1fr; } }

    .faq { display: flex; flex-direction: column; gap: 10px; }
    .faq details { background: var(--fondo); border: 1px solid var(--gris-oscuro); border-radius: 12px; padding: 4px 18px; }
    .faq details[open] { border-color: var(--azul-oscuro); }
    .faq summary::marker { color: var(--amarillo); }
    .faq summary { min-height: 52px; display: flex; align-items: center; font-weight: 700; cursor: pointer; }
    .faq p { color: var(--texto-suave); margin: 0 0 14px; }

    .cierre { text-align: center; padding: 64px 20px; background: linear-gradient(135deg, var(--azul-oscuro), var(--fondo)); display: flex; flex-direction: column; align-items: center; gap: 18px; }
    .cierre h2 { font-size: clamp(28px, 5vw, 44px); font-style: italic; margin: 0; }
    .pie { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 20px 40px; border-top: 1px solid var(--gris-oscuro); }
    .pie a { color: var(--texto-suave); padding: 8px; }
  `,
})
export class Landing {
  private api = inject(Api);
  private toast = inject(Toast);
  private sanitizer = inject(DomSanitizer);

  protected site = signal<any | null>(null);
  protected hours = HOURS;
  protected faq = FAQ;
  protected year = new Date().getFullYear();
  protected defaultAbout =
    'Somos un motolavado en Bogotá dedicado al lavado y detailing de motos. Cuidamos cada detalle con productos adecuados para cada superficie, recibimos tu moto con fotos de su estado y te avisamos por WhatsApp cuando está lista. Porque sabemos lo que tu moto significa para ti: pasión por tu máquina.';
  protected rating = signal(5);
  protected name = signal('');
  protected comment = signal('');
  protected sent = signal(false);
  protected busy = signal(false);

  protected defaultBusiness =
    'Si tienes una flota de mensajería, domicilios o motos de trabajo, armamos un plan para que estén siempre limpias, con horarios que no frenen tu operación y un solo pago al mes.';
  protected images = computed(() => this.site()?.images ?? []);
  protected beforeAfter = computed(() => this.images().filter((i: any) => i.kind === 'ANTES_DESPUES' && i.before));
  protected team = computed(() => this.images().filter((i: any) => i.kind === 'EQUIPO'));
  protected cover = computed(() => this.images().find((i: any) => i.kind === 'PORTADA') ?? null);
  protected businessLink = computed(() => {
    const w = this.site()?.whatsapp;
    return w ? `https://wa.me/57${w}?text=${encodeURIComponent('Hola Columbia Shine, quiero cotizar un plan de lavado para mi flota de motos.')}` : null;
  });
  dayName = (d: string) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  protected bases = computed(() => (this.site()?.services ?? []).filter((s: any) => s.kind === 'BASE'));
  protected whatsapp = computed(() => {
    const w = this.site()?.whatsapp;
    return w ? `https://wa.me/57${w}?text=${encodeURIComponent('Hola Columbia Shine, quiero agendar un lavado para mi moto.')}` : null;
  });
  protected mapLink = computed(() => {
    const s = this.site();
    if (!s) return null;
    return s.mapsUrl || (s.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address + ', Bogotá')}` : null);
  });
  protected mapEmbed = computed(() => {
    const a = this.site()?.address;
    return a ? this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.google.com/maps?q=${encodeURIComponent(a + ', Bogotá')}&output=embed`) : null;
  });
  /** Las cifras se muestran cuando ya dicen algo (no "3 motos entregadas") */
  protected stats = computed(() => {
    const s = this.site();
    if (!s) return null;
    const bikes = s.stats.bikes >= 50 ? Math.floor(s.stats.bikes / 10) * 10 : 0;
    const customers = s.stats.customers >= 30 ? Math.floor(s.stats.customers / 10) * 10 : 0;
    const score = s.score?.n >= 3 ? s.score.avg : null;
    return bikes || customers || score ? { bikes, customers, score, reviews: s.score?.n } : null;
  });

  constructor() {
    // En la app instalada (ícono del celular), quien ya entró como equipo va a su pantalla de trabajo.
    // En el navegador la página pública se ve siempre, aunque haya sesión (por ejemplo, en otra pestaña).
    const u = inject(Session).user();
    const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    if (installed && u && u.role !== 'CLIENT') {
      inject(Router).navigateByUrl(homeFor(u.role));
      return;
    }
    this.api.get('/public/site').then((s) => {
      this.site.set(s);
    }, this.toast.fail);
  }

  thousands = (n: number) => new Intl.NumberFormat('es-CO').format(n);
  stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  round = Math.round;
  planLink = (p: any) => `https://wa.me/57${this.site()?.whatsapp}?text=${encodeURIComponent('Hola Columbia Shine, me interesa la membresía ' + p.name + '.')}`;
  saving = (p: any) => p.washes * p.service_price - p.price;


  async sendReview() {
    if (!this.name().trim() || !this.comment().trim()) return this.toast.show('Escribe tu nombre y tu comentario.', true);
    this.busy.set(true);
    try {
      await this.api.post('/public/reviews', { name: this.name(), rating: this.rating(), comment: this.comment() });
      this.sent.set(true);
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}
