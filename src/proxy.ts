import { NextRequest, NextResponse } from "next/server";

const protectedRoutes = ["/admin", "/dashboard", "/manager", "/owner", "/hk-admin", "/settings"];
const supportedRoles = ["admin", "owner", "manager", "hk_admin", "cleaner"];

function dashboardForRole(role: string) {
	if (role === "cleaner") return "/dashboard";
	if (role === "manager") return "/manager";
	if (role === "owner") return "/owner";
	if (role === "hk_admin") return "/hk-admin";
	return "/admin";
}

export function proxy(request: NextRequest) {
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

	if (!role || !supportedRoles.includes(role) || !userId || !email) {
		const loginUrl = new URL("/login", request.url);
		loginUrl.searchParams.set("next", pathname);
		return NextResponse.redirect(loginUrl);
	}

	if (pathname.startsWith("/dashboard") && role !== "cleaner") {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/admin") && !["admin", "owner", "manager"].includes(role)) {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/manager") && !["admin", "manager"].includes(role)) {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/owner") && !["admin", "owner"].includes(role)) {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/hk-admin") && role !== "hk_admin") {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/settings") && !supportedRoles.includes(role)) {
		return NextResponse.redirect(new URL("/admin", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/admin/:path*", "/dashboard/:path*", "/manager/:path*", "/owner/:path*", "/hk-admin/:path*", "/settings/:path*"],
};
