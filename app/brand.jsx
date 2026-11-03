import Image from "next/image";
import Link from "next/link";

export default function Brand({ light = false }) {
  return <Link className="site-brand" href="/" aria-label="Queryra home">
    <Image src={light ? "/queryra-logo-light.svg" : "/queryra-logo-dark.svg"} alt="" width={42} height={42} priority />
    <span>queryra<span className="brand-period">.</span></span>
  </Link>;
}
