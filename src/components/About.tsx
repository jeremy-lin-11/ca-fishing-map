import { useEffect, useState } from 'react';
import { CONFIG } from '../config';
import { LINKS } from '../regs';

const ACCEPTED_KEY = 'disclaimer-accepted-v1';
const IOS_TIP_KEY = 'ios-install-tip-v1';
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const SOURCES: [string, string, string][] = [
  ['Fishing regulations, MPAs, rockfish depth lines, Salton Sea depth', 'California Department of Fish and Wildlife (CDFW) public GIS data', 'https://wildlife.ca.gov/Data/GIS'],
  ['Bays and harbors', 'Pacific Marine and Estuarine Fish Habitat Partnership, estuary extent (via CDFW BIOS)', 'https://www.arcgis.com/home/item.html?id=c0b97243451f46db84b51d044424b51a'],
  ['Fishing pressure signals', 'Caltrans public roads, CDFW stocked waters and planting log, National Wilderness Preservation System, CA Coastal Commission access points, USDA Forest Service recreation sites', 'https://wildlife.ca.gov/Fishing/Inland/Fish-Planting'],
  ['Land ownership', 'CAL FIRE, California Land Ownership', 'https://www.fire.ca.gov/what-we-do/fire-resource-assessment-program'],
  ['Place search: lake, stream and trail names', '© OpenStreetMap contributors (ODbL)', 'https://www.openstreetmap.org/copyright'],
  ['Unit names, water bodies, counties, towns', 'Esri Living Atlas (USGS, US Census Bureau)', 'https://livingatlas.arcgis.com'],
  ['Basemaps', 'USGS The National Map (public domain)', 'https://www.usgs.gov/programs/national-geospatial-program/national-map'],
  ['Ocean depth and relief', 'NOAA NCEI and GEBCO', 'https://www.ncei.noaa.gov/products/etopo-global-relief-model'],
  ['Lake Tahoe depth', 'Keep Tahoe Blue', 'https://www.keeptahoeblue.org']
];

function Disclaimer() {
  return <>
    <p><b>This is not an official CDFW tool and isn't affiliated with any agency.</b> It combines public data to help you
      check where fishing is allowed, but that data can be out of date, incomplete or wrong. In particular, the regulation text
      comes from a CDFW dataset copied from an older printed booklet.</p>
    <p>You are responsible for knowing and following the current regulations, land access rules, closures and permit
      requirements. Always check the <a target="_blank" rel="noopener" href={LINKS.inland}>current freshwater</a> and{' '}
      <a target="_blank" rel="noopener" href={LINKS.ocean}>ocean</a> regulations before you fish. Provided as is, without warranty.</p>
  </>;
}

// First-visit notice that must be acknowledged.
export function DisclaimerGate() {
  const [accepted, setAccepted] = useState(() => { try { return localStorage.getItem(ACCEPTED_KEY) === '1'; } catch { return false; } });
  if (accepted) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title">
      <div className="modal">
        <h2 id="disclaimer-title">Before you use this map</h2>
        <Disclaimer />
        <button type="button" onClick={() => { try { localStorage.setItem(ACCEPTED_KEY, '1'); } catch { /* private mode */ } setAccepted(true); }}>
          I understand</button>
      </div>
    </div>
  );
}

// On iPhone/iPad, Safari can clear a website's saved data after a week without visits; installed apps keep it.
export function IOSInstallTip() {
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(isIOS() && !isInstalled() && localStorage.getItem(IOS_TIP_KEY) !== '1'); } catch { /* ignore */ } }, []);
  if (!show) return null;
  return (
    <p className="hint offline-note">On iPhone, tap Share, then <b>Add to Home Screen</b>. Installed, the app keeps saved offline
      areas; in Safari they can be cleared after a week without visits.{' '}
      <button type="button" className="linkbtn" onClick={() => { try { localStorage.setItem(IOS_TIP_KEY, '1'); } catch { /* ignore */ } setShow(false); }}>Dismiss</button></p>
  );
}

export default function About() {
  return (
    <details className="card about">
      <summary>About &amp; data sources</summary>
      <Disclaimer />
      <h3>Data sources</h3>
      <ul>{SOURCES.map(([what, who, href]) => <li key={what}>{what}: <a target="_blank" rel="noopener" href={href}>{who}</a></li>)}</ul>
      <p className="hint">The trail, lake and stream data is extracted from OpenStreetMap and is available under the{' '}
        <a target="_blank" rel="noopener" href="https://opendatacommons.org/licenses/odbl/">Open Database License</a>.
        This app doesn't use cookies or tracking; saved offline areas stay on your device.</p>
      {CONFIG.feedbackUrl && <p><a target="_blank" rel="noopener" href={CONFIG.feedbackUrl}>Report a problem or a wrong regulation</a></p>}
    </details>
  );
}
