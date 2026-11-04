import { NextRequest, NextResponse } from "next/server";

const protectedRoutes = ["/admin", "/dashboard", "/manager", "/owner", "/hk-admin", "/settings"];
const supportedRoles = ["super_admin", "admin", "owner", "manager", "housekeeping_admin", "hk_admin", "cleaner"];
const sessionCookieNames = ["role", "user-id", "hotel-id", "user-email", "chat-session-proof"];

function dashboardForRole(role: string) {
	if (role === "cleaner") return "/dashboard";
	if (role === "manager") return "/manager";
	if (role === "owner") return "/owner";
	if (role === "housekeeping_admin" || role === "hk_admin") return "/hk-admin";
	return "/admin";
}

function clearSessionCookies(response: NextResponse, request: NextRequest) {
	const cookieNames = new Set([
		...sessionCookieNames,
		...request.cookies.getAll()
			.map(({ name }) => name)
			.filter((name) => name.startsWith("sb-") && name.includes("-auth-token")),
	]);
	for (const name of cookieNames) {
		response.cookies.set(name, "", {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 0,
		});
	}
	return response;
}

async function isActiveUser(userId: string) {
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl || !serviceRoleKey) {
		throw new Error("Supabase server credentials are required to verify account status.");
	}

	const profileUrl = new URL("/rest/v1/users", supabaseUrl);
	profileUrl.searchParams.set("id", `eq.${userId}`);
	profileUrl.searchParams.set("select", "is_active");
	const response = await fetch(profileUrl, {
		headers: {
			apikey: serviceRoleKey,
			authorization: `Bearer ${serviceRoleKey}`,
		},
		cache: "no-store",
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) {
		throw new Error(`Account status lookup failed with status ${response.status}.`);
	}
	const result: unknown = await response.json();
	if (!Array.isArray(result)) throw new Error("Account status lookup returned an invalid response.");
	if (result.length !== 1) return false;
	const profile = result[0];
	return typeof profile === "object" && profile !== null && "is_active" in profile && profile.is_active === true;
}

export async function proxy(request: NextRequest) {
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

	if (!role || !supportedRoles.includes(role) || !userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) || !email) {
		const loginUrl = new URL("/login", request.url);
		loginUrl.searchParams.set("next", pathname);
		return NextResponse.redirect(loginUrl);
	}

	try {
		if (!await isActiveUser(userId)) {
			const loginUrl = new URL("/login", request.url);
			loginUrl.searchParams.set("error", "account_deactivated");
			return clearSessionCookies(NextResponse.redirect(loginUrl), request);
		}
	} catch (error) {
		console.error("[Auth Exception]: Unable to verify the current account status in proxy.", error);
		return NextResponse.json({ error: "Unable to verify the current account status. Please try again." }, { status: 503 });
	}

	if (pathname.startsWith("/dashboard") && role !== "cleaner") {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/admin") && !["super_admin", "admin", "owner", "manager"].includes(role)) {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/manager") && !["super_admin", "admin", "manager"].includes(role)) {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/owner") && !["super_admin", "admin", "owner"].includes(role)) {
		return NextResponse.redirect(new URL(dashboardForRole(role), request.url));
	}

	if (pathname.startsWith("/hk-admin") && role !== "housekeeping_admin" && role !== "hk_admin") {
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
