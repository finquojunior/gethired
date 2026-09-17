import Script from 'next/script';
import { META_PIXEL_ID } from '@/lib/meta';

// Meta Pixel base code on every public careers page (root / redirects here).
// Staff /app and the candidate portal /c stay untracked. Dev/preview never load it.
export default function CareersLayout({ children }: { children: React.ReactNode }) {
  const track = process.env.NODE_ENV === 'production';
  return (
    <>
      {track && (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">{`
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');
          `}</Script>
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              alt=""
              src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}
      {children}
    </>
  );
}
