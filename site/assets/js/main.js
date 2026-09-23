/*
 * Horse Stories by the Forners – progressive enhancement.
 * Navigation (burger menu), carousels, scroll reveal and footer year.
 * The page is fully usable without this file.
 */
(function () {
  'use strict';

  // Loaded in <head> without "defer" so this class is set before the first paint.
  document.documentElement.classList.add('js');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Navigation ---------- */
  function initNavigation() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
      document.body.classList.toggle('nav-open', open);
    }

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      setOpen(open);
      if (open) {
        var firstLink = nav.querySelector('a');
        if (firstLink) firstLink.focus();
      }
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    var desktop = window.matchMedia('(min-width: 64em)');
    var onChange = function (event) {
      if (event.matches) setOpen(false);
    };
    if (desktop.addEventListener) desktop.addEventListener('change', onChange);
    else if (desktop.addListener) desktop.addListener(onChange);
  }

  /* ---------- Carousel ---------- */
  // Reusable carousel built on a native scroll-snap track.
  // Touch swipe is handled by native scrolling; JS adds arrows, dots and keyboard support.
  var ARROW_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  var ARROW_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7"/></svg>';

  function Carousel(root) {
    this.root = root;
    this.track = root.querySelector('.carousel__track');
    this.slides = this.track ? Array.prototype.slice.call(this.track.children) : [];
    this.index = 0;
    this.ticking = false;
    if (this.slides.length < 2) return;

    this.setupSemantics();
    this.buildControls();
    this.bindEvents();
    this.update(false);
  }

  Carousel.prototype.setupSemantics = function () {
    var total = this.slides.length;
    // The root is a <section> with a label, so it is exposed as a region already.
    this.root.setAttribute('aria-roledescription', 'Karussell');
    this.slides.forEach(function (slide, i) {
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-roledescription', 'Bild');
      slide.setAttribute('aria-label', (i + 1) + ' von ' + total);
    });
  };

  Carousel.prototype.createButton = function (className, label, icon) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'carousel__button ' + className;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  };

  Carousel.prototype.buildControls = function () {
    var self = this;
    var total = this.slides.length;
    var controls = document.createElement('div');
    controls.className = 'carousel__controls';

    this.prevButton = this.createButton('carousel__button--prev', 'Vorheriges Bild', ARROW_PREV);
    this.nextButton = this.createButton('carousel__button--next', 'Nächstes Bild', ARROW_NEXT);
    this.prevButton.addEventListener('click', function () { self.goTo(self.index - 1); });
    this.nextButton.addEventListener('click', function () { self.goTo(self.index + 1); });

    var dots = document.createElement('div');
    dots.className = 'carousel__dots';
    this.dots = this.slides.map(function (slide, i) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carousel__dot';
      dot.setAttribute('aria-label', 'Bild ' + (i + 1) + ' von ' + total + ' anzeigen');
      dot.addEventListener('click', function () { self.goTo(i); });
      dots.appendChild(dot);
      return dot;
    });

    this.status = document.createElement('p');
    this.status.className = 'visually-hidden';
    this.status.setAttribute('aria-live', 'polite');

    controls.appendChild(this.prevButton);
    controls.appendChild(dots);
    controls.appendChild(this.nextButton);
    this.root.appendChild(controls);
    this.root.appendChild(this.status);
  };

  Carousel.prototype.bindEvents = function () {
    var self = this;
    this.track.addEventListener('scroll', function () {
      if (self.ticking) return;
      self.ticking = true;
      window.requestAnimationFrame(function () {
        self.ticking = false;
        var width = self.track.clientWidth || 1;
        var current = Math.round(self.track.scrollLeft / width);
        current = Math.max(0, Math.min(self.slides.length - 1, current));
        if (current !== self.index) {
          self.index = current;
          self.update(true);
        }
      });
    }, { passive: true });

    this.root.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        self.goTo(self.index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        self.goTo(self.index + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        self.goTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        self.goTo(self.slides.length - 1);
      }
    });

    // Keep the current slide aligned when the viewport size changes.
    var resizeTimer;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        self.track.scrollTo({ left: self.slides[self.index].offsetLeft, behavior: 'auto' });
      }, 150);
    });
  };

  Carousel.prototype.goTo = function (target) {
    var index = Math.max(0, Math.min(this.slides.length - 1, target));
    if (index === this.index && Math.abs(this.track.scrollLeft - this.slides[index].offsetLeft) < 2) return;
    this.index = index;
    this.track.scrollTo({
      left: this.slides[index].offsetLeft,
      behavior: reducedMotion.matches ? 'auto' : 'smooth'
    });
    this.update(true);
  };

  Carousel.prototype.update = function (announce) {
    var index = this.index;
    this.dots.forEach(function (dot, i) {
      if (i === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    this.prevButton.disabled = index === 0;
    this.nextButton.disabled = index === this.slides.length - 1;
    if (announce) this.status.textContent = 'Bild ' + (index + 1) + ' von ' + this.slides.length;
  };

  function initCarousels() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-carousel]'), function (root) {
      new Carousel(root);
    });
  }

  /* ---------- Scroll reveal ---------- */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (item) { item.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    Array.prototype.forEach.call(items, function (item) { observer.observe(item); });
  }

  /* ---------- Footer year ---------- */
  function initYear() {
    var year = String(new Date().getFullYear());
    Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (el) {
      el.textContent = year;
    });
  }

  function init() {
    initNavigation();
    initCarousels();
    initReveal();
    initYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
