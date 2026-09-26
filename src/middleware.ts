import { NextRequest, NextResponse } from "next/server";

const protectedRoutes = ["/admin", "/dashboard", "/manager", "/owner", "/settings"];

export function middleware(request: NextRequest) {
	const pathname = request.nextUrl.pathname;
	const isProtectedRoute = protectedRoutes.some(
		(route) => pathname === route || pathname.startsWith(`${route}/`),
	);

	if (!isProtectedRoute) {
		return NextResponse.next();
	}

	const role = request.cookies.get("role")?.value;
	const userId = request.cookies.get("user-id")?.value;
	const email = request.cookies.get("user-email")?.value;

	if (!role || !userId || !email) {
		const loginUrl = new URL("/login", request.url);
		loginUrl.searchParams.set("next", pathname);
		return NextResponse.redirect(loginUrl);
	}

	if (pathname.startsWith("/dashboard") && role !== "cleaner") {
		return NextResponse.redirect(new URL("/admin", request.url));
	}

	if (pathname.startsWith("/admin") && !["admin", "owner", "manager"].includes(role)) {
		return NextResponse.redirect(new URL("/dashboard", request.url));
	}

	if (pathname.startsWith("/manager") && !["admin", "manager"].includes(role)) {
		return NextResponse.redirect(new URL("/admin", request.url));
	}

	if (pathname.startsWith("/owner") && !["admin", "owner"].includes(role)) {
		return NextResponse.redirect(new URL("/admin", request.url));
	}

	if (pathname.startsWith("/settings") && !["admin", "owner", "manager", "cleaner"].includes(role)) {
		return NextResponse.redirect(new URL("/admin", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/admin/:path*", "/dashboard/:path*", "/manager/:path*", "/owner/:path*", "/settings/:path*"],
};
